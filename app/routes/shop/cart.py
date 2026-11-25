"""Customer cart: read, add, change quantity and remove items with stock and seed-policy checks."""
import hashlib
import json

from bson import ObjectId
from flask import g, jsonify, request
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from ...db import get_database, stamp_insert, stamp_update
from ...domain.validation import obj, whole
from ...security import api_error, auth_required
from .common import LISTED_PRODUCT, artist_is_eligible, demo_product, eligible_artist_ids, jsonify_doc, oid, safe, shop_bp, written


@shop_bp.get('/cart')
@auth_required('customer')
@safe
def get_cart():
    """Read the caller's unique cart with product display details; empty carts are not inserted."""
    db = get_database()
    doc = db.cart.find_one({'customerId': g.current_user['_id']})
    if not doc:
        return jsonify(cart={'customerId': str(g.current_user['_id']), 'items': [], 'revision': cart_revision(None)}), 200
    return jsonify(cart=cart_payload(db, doc)), 200


def cart_payload(db, doc):
    """Return available product details or only a title for unavailable cart lines."""
    cart = jsonify_doc(doc)
    cart['revision'] = cart_revision(doc)
    ids = [x['productId'] for x in doc.get('items', [])]
    eligible = set(eligible_artist_ids(db))
    products = {p['_id']: p for p in db.products.find({'_id': {'$in': ids}, **LISTED_PRODUCT}, {'title': 1, 'price': 1, 'category': 1, 'images': 1, 'inventory': 1, 'artistId': 1})}
    unavailable_ids = [pid for pid in ids if not visible_product(products.get(pid), eligible)]
    titles = {p['_id']: p.get('title') for p in db.products.find({'_id': {'$in': unavailable_ids}}, {'title': 1})} if unavailable_ids else {}
    cart['items'] = []
    for item in doc.get('items', []):
        pid = item['productId']
        product = cart_product(visible_product(products.get(pid), eligible))
        line = {'productId': str(pid), 'quantity': item['quantity'], 'product': product}
        if product is None:
            line['productTitle'] = titles.get(pid)
        cart['items'].append(line)
    return cart


def cart_revision(cart):
    """Represent the cart state using its identity, timestamp and exact item contents."""
    if cart is None:
        return 'empty'
    state = {'id': str(cart['_id']), 'updatedAt': jsonify_doc(cart.get('updatedAt')),
             'items': jsonify_doc(cart['items'])}
    encoded = json.dumps(state, sort_keys=True, separators=(',', ':')).encode('utf-8')
    return hashlib.sha256(encoded).hexdigest()


def cart_snapshot_filter(cart):
    """Match the exact state read, including legacy carts without updatedAt."""
    return {'_id': cart['_id'], 'customerId': cart['customerId'],
            'items': cart['items'],
            'updatedAt': cart['updatedAt'] if 'updatedAt' in cart else {'$exists': False}}


def cart_conflict():
    return api_error('CART_CONFLICT', 'Your cart changed. Refresh it and try again.', 409)


def revision_matches(cart):
    return request.headers.get('X-Cart-Revision') == cart_revision(cart)


def visible_product(p, eligible_artists):
    """Hide a listed product whose artist is not currently eligible, so it reappears when the artist is approved again."""
    return p if p and p['artistId'] in eligible_artists else None


def stock_of(p):
    """Return the product's stock as an int so every stock comparison behaves the same regardless of stored numeric type."""
    value = (p.get('inventory') or {}).get('quantityAvailable') or 0
    if hasattr(value, 'to_decimal'):
        value = value.to_decimal()
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


def cart_product(p):
    """Return only the product fields the cart displays; None marks a product that is no longer available."""
    if not p:
        return None
    return {'_id': str(p['_id']), 'title': p.get('title'), 'price': jsonify_doc(p.get('price')), 'category': p.get('category'), 'images': p.get('images') or [], 'quantityAvailable': stock_of(p)}


@shop_bp.post('/cart/items')
@auth_required('customer')
@safe
def cart_add():
    """Add or merge a cart item with an optimistic concurrency check."""
    denied = written()
    if denied:
        return denied
    data = obj(request.get_json(silent=True), {'productId', 'quantity'}, ('productId', 'quantity'))
    qty = whole(data['quantity'], 'quantity', 1, 100)
    db = get_database()
    pid = oid(data['productId'])
    product = db.products.find_one({'_id': pid, **LISTED_PRODUCT})
    if not product or not artist_is_eligible(db, product['artistId']):
        return api_error('NOT_FOUND', 'Active product not found', 404)
    if not demo_product(db, product):
        return api_error('SEEDED_RECORD_PROTECTED', 'Demo purchases use newly registered artists and their products only', 403)
    existing = db.cart.find_one({'customerId': g.current_user['_id']})
    if not revision_matches(existing):
        return cart_conflict()
    items = [dict(item) for item in existing['items']] if existing else []
    match = next((x for x in items if x['productId'] == pid), None)
    total = (match['quantity'] if match else 0) + qty
    if total > 100:
        return api_error('OUT_OF_STOCK', 'You can add up to 100 of one product', 409)
    available = stock_of(product)
    if total > available:
        return api_error('OUT_OF_STOCK', f"Cannot add more. Only {available} available in stock", 409)
    if match:
        match['quantity'] = total
    else:
        items.append({'productId': pid, 'quantity': qty})
    if existing is None:
        cart = stamp_insert({'_id': ObjectId(), 'customerId': g.current_user['_id'], 'items': items})
        try:
            db.cart.insert_one(cart)
        except DuplicateKeyError:
            if db.cart.find_one({'customerId': g.current_user['_id']}):
                return cart_conflict()
            raise
        cart = db.cart.find_one({'_id': cart['_id'], 'customerId': g.current_user['_id']})
        if cart is None:
            return cart_conflict()
    else:
        cart = db.cart.find_one_and_update(cart_snapshot_filter(existing), {'$set': stamp_update({'items': items})}, return_document=ReturnDocument.AFTER)
        if cart is None:
            return cart_conflict()
    return jsonify(cart=cart_payload(db, cart)), 200


@shop_bp.patch('/cart/items/<item_id>')
@auth_required('customer')
@safe
def cart_quantity(item_id):
    """Replace an existing cart quantity after validating the integer and available stock."""
    denied = written()
    if denied:
        return denied
    data = obj(request.get_json(silent=True), {'quantity'}, ('quantity',))
    qty = whole(data['quantity'], 'quantity', 1, 100)
    pid = oid(item_id)
    db = get_database()
    cart = db.cart.find_one({'customerId': g.current_user['_id']})
    if not revision_matches(cart):
        return cart_conflict()
    if not cart or not any(x['productId'] == pid for x in cart['items']):
        return api_error('NOT_FOUND', 'Cart item not found', 404)
    product = db.products.find_one({'_id': pid, **LISTED_PRODUCT})
    if not product or not artist_is_eligible(db, product['artistId']):
        return api_error('NOT_FOUND', 'This product is no longer available', 404)
    available = stock_of(product)
    if qty > available:
        return api_error('OUT_OF_STOCK', f'Cannot set quantity above {available}. Only {available} available in stock', 409)
    items = [{**x, 'quantity': qty} if x['productId'] == pid else x for x in cart['items']]
    updated = db.cart.find_one_and_update(cart_snapshot_filter(cart), {'$set': stamp_update({'items': items})}, return_document=ReturnDocument.AFTER)
    if updated is None:
        return cart_conflict()
    return jsonify(cart=cart_payload(db, updated)), 200


@shop_bp.delete('/cart/items/<item_id>')
@auth_required('customer')
@safe
def cart_remove(item_id):
    """Remove an item from the eligible customer's own cart without deleting the product."""
    denied = written()
    if denied:
        return denied
    pid = oid(item_id)
    db = get_database()
    cart = db.cart.find_one({'customerId': g.current_user['_id']})
    if not revision_matches(cart):
        return cart_conflict()
    if not cart or not any(x['productId'] == pid for x in cart['items']):
        return api_error('NOT_FOUND', 'Cart item not found', 404)
    updated = db.cart.find_one_and_update(cart_snapshot_filter(cart), {'$pull': {'items': {'productId': pid}}, '$set': stamp_update({})}, return_document=ReturnDocument.AFTER)
    if updated is None:
        return cart_conflict()
    return jsonify(cart=cart_payload(db, updated)), 200
