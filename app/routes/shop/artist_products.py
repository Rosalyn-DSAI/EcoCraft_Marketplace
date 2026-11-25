"""Artist product management: owned listings, photo upload, create, edit and soft delete."""
from bson import Decimal128, ObjectId
from flask import current_app, g, jsonify, request
from pymongo.errors import PyMongoError

from ...db import get_database, stamp_insert, stamp_update
from ...image_uploads import (MAX_IMAGE_BYTES, MAX_REQUEST_BYTES, InvalidImage,
                              UploadFailed, UploadNotConfigured, upload_product_photo)
from ...domain.products import parse_product
from ...security import api_error, artist_not_approved_message, auth_required
from .common import add_rating_summaries, demo_artist, jsonify_doc, oid, safe, shop_bp, written


def own_product(db, product_id):
    """Find an artist-owned editable product; deny another artist's or original seed product."""
    doc = db.products.find_one({'_id': product_id, 'artistId': g.current_user['_id'], 'active': {'$ne': False}})
    if not doc:
        return None
    if not demo_artist(db, doc['artistId']):
        return None
    return doc


@shop_bp.get('/products/mine')
@auth_required('artist')
@safe
def my_products():
    """Read the authenticated artist's listings, including products awaiting moderation and soft-deleted ones (active=false)."""
    db = get_database()
    products = list(db.products.find({'artistId': g.current_user['_id']}).sort('_id', -1).limit(200))
    add_rating_summaries(db, products)
    return jsonify(products=jsonify_doc(products)), 200


@shop_bp.post('/products/image-upload')
@auth_required('artist')
@safe
def upload_image():
    """Upload an eligible artist photo to hosting; product creation remains a separate request."""
    denied = written()
    if denied:
        return denied
    if g.current_user.get('artistProfile', {}).get('onboardingStatus') != 'approved':
        return api_error('ARTIST_NOT_APPROVED', artist_not_approved_message(g.current_user), 403)
    # Set before accessing multipart data; other API requests retain the 16 KB limit.
    request.max_content_length = MAX_REQUEST_BYTES
    photo = request.files.get('file')
    if photo is None:
        return api_error('VALIDATION_ERROR', 'Choose an image first', 400)
    raw = photo.stream.read(MAX_IMAGE_BYTES + 1)
    if len(raw) > MAX_IMAGE_BYTES:
        return api_error('PAYLOAD_TOO_LARGE', 'Image must be 4 MB or smaller', 413)
    try:
        url = upload_product_photo(raw, current_app.config['CLOUDINARY_CLOUD_NAME'],
                                   current_app.config['CLOUDINARY_API_KEY'],
                                   current_app.config['CLOUDINARY_API_SECRET'])
    except InvalidImage as exc:
        return api_error('VALIDATION_ERROR', str(exc), 400)
    except UploadNotConfigured:
        return api_error('UPLOAD_NOT_CONFIGURED', 'Image uploading is not configured; use an HTTPS image URL', 503)
    except UploadFailed:
        return api_error('UPLOAD_FAILED', 'Image hosting service could not complete the upload', 502)
    return jsonify(url=url), 201


@shop_bp.post('/products')
@auth_required('artist')
@safe
def create_product():
    """Insert a new owned product with server-controlled pending status and Decimal128 price."""
    denied = written()
    if denied:
        return denied
    fields = parse_product(request.get_json(silent=True))
    fields['price'] = Decimal128(fields['price'])
    doc = {'_id': ObjectId(), 'artistId': g.current_user['_id'], **fields, 'commissionRate': 10, 'approvalStatus': 'pending_review', 'listProduct': False}
    get_database().products.insert_one(stamp_insert(doc))
    return jsonify(product=jsonify_doc(doc), message='Product submitted for admin approval'), 201


@shop_bp.patch('/products/<item_id>')
@auth_required('artist')
@safe
def update_product(item_id):
    """Validate an owned product edit, protect ordered inventory and resubmit only rejected products for review."""
    denied = written()
    if denied:
        return denied
    db = get_database()
    existing = own_product(db, oid(item_id))
    if not existing:
        return api_error('NOT_FOUND', 'Editable product not found', 404)
    # Inventory is derived from orders; disallow direct inventory replacement on products already ordered.
    changes = parse_product(request.get_json(silent=True), partial=True)
    if 'price' in changes:
        changes['price'] = Decimal128(changes['price'])
    if 'inventory.quantityAvailable' in changes and db.orders.find_one({'items.productId': existing['_id']}):
        if changes['inventory.quantityAvailable'] != existing['inventory']['quantityAvailable']:
            return api_error('CONFLICT', 'Inventory of ordered products cannot be directly overwritten', 409)
        del changes['inventory.quantityAvailable']
    # Listed products keep admin-verified sustainability; only rejected products are resubmitted for review.
    if existing.get('listProduct') and existing.get('approvalStatus') == 'approved' and 'sustainability' in changes:
        return api_error('CONFLICT', 'Sustainability of listed products is managed by EcoCraft admins', 409)
    if existing.get('approvalStatus') == 'rejected':
        changes.update({'approvalStatus': 'pending_review', 'listProduct': False})
    result = db.products.update_one(
        {'_id': existing['_id'], 'artistId': g.current_user['_id'],
         'approvalStatus': existing.get('approvalStatus'), 'listProduct': existing.get('listProduct'),
         'active': {'$ne': False}},
        {'$set': stamp_update(changes)},
    )
    if result.matched_count == 0:
        return api_error('CONFLICT', 'Product status changed; refresh and try again', 409)
    return jsonify(product=jsonify_doc(db.products.find_one({'_id': existing['_id']}))), 200


@shop_bp.delete('/products/<item_id>')
@auth_required('artist')
@safe
def delete_product(item_id):
    """Soft-delete an owned product by setting active=false; no document is removed from the database."""
    denied = written()
    if denied:
        return denied
    db = get_database()
    artist_id = g.current_user['_id']
    product_id = oid(item_id)
    try:
        existing = own_product(db, product_id)
    except PyMongoError:
        current_app.logger.exception('Product delete failed at ownership lookup: product=%s artist=%s', item_id, artist_id)
        raise
    if not existing:
        current_app.logger.warning('Product delete refused: product=%s artist=%s not found, not owned or not editable', item_id, artist_id)
        return api_error('NOT_FOUND', 'Editable product not found', 404)
    try:
        result = db.products.update_one({'_id': existing['_id'], 'artistId': artist_id}, {'$set': stamp_update({'active': False})})
    except PyMongoError:
        current_app.logger.exception('Product delete failed at soft-delete update: product=%s artist=%s', item_id, artist_id)
        raise
    if result.matched_count != 1:
        current_app.logger.warning('Product delete matched %s documents: product=%s artist=%s', result.matched_count, item_id, artist_id)
    try:
        db.cart.update_many({'items.productId': existing['_id']}, {'$pull': {'items': {'productId': existing['_id']}}, '$set': stamp_update({})})
    except PyMongoError:
        current_app.logger.exception('Product delete failed at cart cleanup: product=%s artist=%s', item_id, artist_id)
        raise
    return jsonify(message='Product deleted'), 200
