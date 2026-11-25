"""Admin moderation of artists and products: review queues, approvals and sustainability verification."""
from flask import jsonify, request

from ...db import get_database, stamp_update
from ...domain.products import rate
from ...domain.sustainability import parse_sustainability
from ...domain.validation import BadInput, obj
from ...security import api_error, auth_required, can_edit_user, public_user, require_write_enabled
from ..shop.common import demo_product, jsonify_doc, oid, safe
from .common import admin_bp


@admin_bp.get('/products')
@auth_required('admin')
@safe
def admin_products():
    """Read a paged moderation list (newest first), optionally filtered by status and selected artists."""
    status = request.args.get('status', 'pending_review')
    if status not in {'pending_review', 'approved', 'rejected', 'all'}:
        raise BadInput('Invalid status')
    page_arg = request.args.get('page', '1')
    if not page_arg.isdecimal() or not (1 <= int(page_arg) <= 10000):
        raise BadInput('page must be between 1 and 10000')
    page = int(page_arg)
    q = {'active': {'$ne': False}} if status == 'all' else {'approvalStatus': status, 'active': {'$ne': False}}
    artist_arg = request.args.get('artistIds', '')
    if artist_arg:
        artist_ids = [oid(x) for x in artist_arg.split(',') if x]
        if len(artist_ids) > 50:
            raise BadInput('At most 50 artists can be selected')
        q['artistId'] = {'$in': artist_ids}
    db = get_database()
    total = db.products.count_documents(q)
    docs = list(db.products.find(q).sort('_id', -1).skip((page - 1) * 50).limit(50))
    names = {u['_id']: u['personalInfo']['firstName'] + ' ' + u['personalInfo']['lastName'] for u in db.users.find({'_id': {'$in': list({d['artistId'] for d in docs})}}, {'personalInfo': 1})}
    for d in docs:
        d['artistName'] = names.get(d['artistId'], 'Unknown artist')
    return jsonify(products=jsonify_doc(docs), page=page, pageSize=50, total=total, totalPages=max(1, (total + 49) // 50)), 200


# Allowed admin moves between onboarding statuses; mirrors the actions offered in the artist approvals UI.
ARTIST_TRANSITIONS = {
    'request_received': {'waiting_for_documents'},
    'waiting_for_documents': {'received_documents'},
    'received_documents': {'waiting_for_documents', 'approved', 'rejected'},
}


@admin_bp.patch('/artists/<artist_id>/approval')
@auth_required('admin')
@safe
def review_artist(artist_id):
    """Let an admin move an eligible artist along the allowed onboarding transitions, preserving original artist records."""
    denied = require_write_enabled()
    if denied:
        return denied
    data = obj(request.get_json(silent=True), {'status'}, ('status',))
    status = data['status']
    if not isinstance(status, str) or status not in {'approved', 'rejected', 'waiting_for_documents', 'received_documents'}:
        raise BadInput('Invalid approval status')
    db = get_database()
    user = db.users.find_one({'_id': oid(artist_id), 'role': 'artist'})
    if not user:
        return api_error('NOT_FOUND', 'Artist not found', 404)
    if not can_edit_user(user):
        return api_error('SEEDED_RECORD_PROTECTED', 'Original artist cannot be modified', 403)
    current = user.get('artistProfile', {}).get('onboardingStatus')
    if status not in ARTIST_TRANSITIONS.get(current, set()):
        return api_error('CONFLICT', f'Artist cannot move from {current} to {status}', 409)
    result = db.users.update_one(
        {'_id': user['_id'], 'userID': user['userID'], 'artistProfile.onboardingStatus': current},
        {'$set': stamp_update({'artistProfile.onboardingStatus': status})},
    )
    if result.matched_count == 0:
        return api_error('CONFLICT', 'Artist status changed; refresh and try again', 409)
    return jsonify(user=public_user(db.users.find_one({'_id': user['_id']}))), 200


@admin_bp.patch('/products/<item_id>/review')
@auth_required('admin')
@safe
def review_product(item_id):
    """Approve-and-list or reject a product that is still in the New (pending review) queue."""
    denied = require_write_enabled()
    if denied:
        return denied
    data = obj(request.get_json(silent=True), {'status', 'commissionRate'}, ('status',))
    if not isinstance(data['status'], str) or data['status'] not in {'approved', 'rejected'}:
        raise BadInput('Invalid product review status')
    if data['status'] == 'approved' and 'commissionRate' not in data:
        raise BadInput('commissionRate is required to approve a product')
    db = get_database()
    doc = db.products.find_one({'_id': oid(item_id), 'active': {'$ne': False}})
    if not doc:
        return api_error('NOT_FOUND', 'Product not found', 404)
    if not demo_product(db, doc):
        return api_error('SEEDED_RECORD_PROTECTED', 'Original products cannot be modified', 403)
    if doc.get('approvalStatus') != 'pending_review':
        return api_error('CONFLICT', f"Only new products can be approved or rejected; this product is {doc.get('approvalStatus')}", 409)
    changes = {'approvalStatus': data['status'], 'listProduct': data['status'] == 'approved'}
    if 'commissionRate' in data:
        changes['commissionRate'] = rate(data['commissionRate'])
    result = db.products.update_one({'_id': doc['_id'], 'approvalStatus': 'pending_review'}, {'$set': stamp_update(changes)})
    if result.matched_count == 0:
        return api_error('CONFLICT', 'Product status changed; refresh and try again', 409)
    return jsonify(product=jsonify_doc(db.products.find_one({'_id': doc['_id']}))), 200


@admin_bp.patch('/products/<item_id>/sustainability')
@auth_required('admin')
@safe
def review_sustainability(item_id):
    """Let an admin verify certifications and edit the sustainability profile without changing listing or commission."""
    denied = require_write_enabled()
    if denied:
        return denied
    data = obj(request.get_json(silent=True), {'sustainability'}, ('sustainability',))
    db = get_database()
    doc = db.products.find_one({'_id': oid(item_id), 'active': {'$ne': False}})
    if not doc:
        return api_error('NOT_FOUND', 'Product not found', 404)
    if not demo_product(db, doc):
        return api_error('SEEDED_RECORD_PROTECTED', 'Original products cannot be modified', 403)
    db.products.update_one({'_id': doc['_id']}, {'$set': stamp_update({'sustainability': parse_sustainability(data['sustainability'], admin=True)})})
    return jsonify(product=jsonify_doc(db.products.find_one({'_id': doc['_id']}))), 200
