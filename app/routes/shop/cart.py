"""Customer cart: read, add, change quantity and remove items with stock and seed-policy checks."""
from bson import ObjectId
from flask import g, jsonify, request

from ...db import get_database, stamp_update, utc_now
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
        return jsonify(cart={'customerId': str(g.current_user['_id']), 'items': []}), 200
    return jsonify(cart=cart_payload(db, doc)), 200


def cart_payload(db, doc):
    """Return the cart with product display details; lines whose product or artist is unavailable get product null."""
    cart = jsonify_doc(doc)
    ids = [x['productId'] for x in doc.get('items', [])]
    eligible = set(eligible_artist_ids(db))
    products = {p['_id']: p for p in db.products.find({'_id': {'$in': ids}, **LISTED_PRODUCT}, {'title': 1, 'price': 1, 'category': 1, 'images': 1, 'inventory': 1, 'artistId': 1})}
    cart['items'] = [{'productId': str(x['productId']), 'quantity': x['quantity'], 'product': cart_product(visible_product(products.get(x['productId']), eligible))} for x in doc.get('items', [])]
    return cart


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
    """Add or merge a cart item after eligibility/stock checks; array replacement is not transactional."""
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
    items = existing['items'][:] if existing else []
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
    db.cart.update_one({'customerId': g.current_user['_id']}, {'$set': stamp_update({'items': items}), '$setOnInsert': {'_id': ObjectId(), 'customerId': g.current_user['_id'], 'createdAt': utc_now()}}, upsert=True)
    return jsonify(cart=cart_payload(db, db.cart.find_one({'customerId': g.current_user['_id']}))), 200


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
    if not cart or not any(x['productId'] == pid for x in cart['items']):
        return api_error('NOT_FOUND', 'Cart item not found', 404)
    product = db.products.find_one({'_id': pid, **LISTED_PRODUCT})
    if not product or not artist_is_eligible(db, product['artistId']):
        return api_error('NOT_FOUND', 'This product is no longer available', 404)
    available = stock_of(product)
    if qty > available:
        return api_error('OUT_OF_STOCK', f'Cannot set quantity above {available}. Only {available} available in stock', 409)
    items = [{**x, 'quantity': qty} if x['productId'] == pid else x for x in cart['items']]
    db.cart.update_one({'_id': cart['_id'], 'customerId': g.current_user['_id']}, {'$set': stamp_update({'items': items})})
    return jsonify(cart=cart_payload(db, db.cart.find_one({'_id': cart['_id']}))), 200


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
    if not cart or not any(x['productId'] == pid for x in cart['items']):
        return api_error('NOT_FOUND', 'Cart item not found', 404)
    db.cart.update_one({'_id': cart['_id'], 'customerId': g.current_user['_id']}, {'$pull': {'items': {'productId': pid}}, '$set': stamp_update({})})
    return jsonify(cart=cart_payload(db, db.cart.find_one({'_id': cart['_id']}))), 200
