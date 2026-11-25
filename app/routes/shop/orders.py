"""Customer checkout and order history, artist sales view, and transactional cancel/ship updates."""
from datetime import datetime, timezone

from bson import Decimal128, ObjectId
from flask import g, jsonify, request

from ...db import get_client, get_database, stamp_insert, stamp_update
from ...domain.orders import amounts, order_status, order_totals, parse_address
from ...domain.validation import BadInput, obj, string, whole
from ...security import api_error, auth_required, can_edit_user
from .common import ELIGIBLE_ARTIST, LISTED_PRODUCT, jsonify_doc, oid, safe, shop_bp, written


@shop_bp.post('/orders/checkout')
@auth_required('customer')
@safe
def checkout():
    """Atomically recheck stock, deduct inventory, create snapshots/totals and clear the caller's cart."""
    denied = written()
    if denied:
        return denied
    payload = obj(request.get_json(silent=True), {'shippingAddress'}, ('shippingAddress',))
    address = parse_address(payload['shippingAddress'])
    db = get_database()
    # The transaction guarantees inventory and order creation succeed or fail together.
    # MongoDB Atlas replica sets support transactions. No silent non-transaction fallback.
    with get_client().start_session() as session:
        with session.start_transaction():
            cart = db.cart.find_one({'customerId': g.current_user['_id']}, session=session)
            if not cart or not cart.get('items'):
                raise BadInput('Cart is empty')
            items = []
            for chosen in cart['items']:
                pid = chosen['productId']
                qty = whole(chosen['quantity'], 'quantity', 1, 100)
                product = db.products.find_one({'_id': pid, **LISTED_PRODUCT}, session=session)
                if not product:
                    raise BadInput('A cart product is no longer available')
                artist = db.users.find_one({'_id': product['artistId'], **ELIGIBLE_ARTIST}, session=session)
                if not artist or not can_edit_user(artist):
                    raise BadInput(f"{product['title']} is not available because its artist is not accepting orders. Remove it to continue.")
                result = db.products.update_one({'_id': pid, 'inventory.quantityAvailable': {'$gte': qty}}, {'$inc': {'inventory.quantityAvailable': -qty}, '$set': stamp_update({})}, session=session)
                if result.modified_count != 1:
                    raise BadInput('Not enough stock for ' + product['title'])
                price = product['price'].to_decimal()
                _, commission, payout = amounts(price, qty, product['commissionRate'])
                items.append({'productId': pid, 'productSnapshot': {'title': product['title'], 'image': (product.get('images') or [None])[0], 'artistId': artist['_id'], 'artistName': artist['personalInfo']['firstName'] + ' ' + artist['personalInfo']['lastName']}, 'quantity': qty, 'unitPrice': product['price'], 'commissionRate': product['commissionRate'], 'commissionAmount': Decimal128(commission), 'artistPayout': Decimal128(payout), 'status': 'active', 'shipping': {'status': 'pending'}})
            totals = {k: Decimal128(v) for k, v in order_totals(items).items()}
            order = {'_id': ObjectId(), 'customerId': g.current_user['_id'], 'items': items, 'shippingAddress': address, 'totals': totals, 'orderStatus': 'pending'}
            db.orders.insert_one(stamp_insert(order), session=session)
            db.cart.delete_one({'_id': cart['_id'], 'customerId': g.current_user['_id']}, session=session)
    return jsonify(order=jsonify_doc(order), message='Order placed (coursework demo; no payment processed)'), 201


@shop_bp.get('/orders/mine')
@auth_required('customer')
@safe
def my_orders():
    """Read only the authenticated customer's order history."""
    db = get_database()
    docs = list(db.orders.find({'customerId': g.current_user['_id']}).sort('_id', -1).limit(100))
    reviews = db.reviews.find({'customerId': g.current_user['_id'], 'orderId': {'$in': [d['_id'] for d in docs]}, 'active': {'$ne': False}})
    by_item = {(r['orderId'], r['productId']): r for r in reviews}
    for doc in docs:
        for item in doc['items']:
            item['review'] = by_item.get((doc['_id'], item['productId']))
    return jsonify(orders=jsonify_doc(docs)), 200


@shop_bp.get('/orders/sales')
@auth_required('artist')
@safe
def artist_sales():
    """Expose only the caller's sales items while retaining original order-item indices."""
    docs = get_database().orders.find({'items.productSnapshot.artistId': g.current_user['_id']}).sort('_id', -1).limit(100)
    # Keep only current artist's item details (avoid disclosure of other artists' sales).
    results = []
    for doc in docs:
        results.append({'orderId': str(doc['_id']), 'createdAt': jsonify_doc(doc.get('createdAt')), 'items': jsonify_doc([{**x, 'itemIndex': i} for i, x in enumerate(doc['items']) if x['productSnapshot']['artistId'] == g.current_user['_id']])})
    return jsonify(sales=results), 200


@shop_bp.patch('/orders/<order_id>/items/<int:idx>/cancel')
@auth_required('customer')
@safe
def cancel_order_item(order_id, idx):
    """Atomically cancel an active unshipped item, restore stock once and recalculate totals."""
    denied = written()
    if denied:
        return denied
    db = get_database()
    user_id = g.current_user['_id']
    order_oid = oid(order_id)
    with get_client().start_session() as session:
        with session.start_transaction():
            order = db.orders.find_one({'_id': order_oid, 'customerId': user_id}, session=session)
            if not order:
                return api_error('NOT_FOUND', 'Order not found', 404)
            if idx < 0 or idx >= len(order['items']):
                raise BadInput('Invalid order item index')
            item = order['items'][idx]
            if item['status'] != 'active' or item['shipping']['status'] != 'pending':
                return api_error('CONFLICT', 'Only active unshipped items can be cancelled', 409)
            product = db.products.find_one({'_id': item['productId']}, session=session)
            artist = db.users.find_one({'_id': item['productSnapshot']['artistId']}, session=session)
            if not product or not artist or not can_edit_user(artist):
                return api_error('SEEDED_RECORD_PROTECTED', 'Original product inventory is protected', 403)
            item['status'] = 'cancelled'
            item['cancelledAt'] = datetime.now(timezone.utc)
            db.products.update_one({'_id': item['productId']}, {'$inc': {'inventory.quantityAvailable': item['quantity']}, '$set': stamp_update({})}, session=session)
            totals = {k: Decimal128(v) for k, v in order_totals(order['items']).items()}
            db.orders.update_one({'_id': order['_id'], 'customerId': user_id}, {'$set': stamp_update({'items': order['items'], 'totals': totals, 'orderStatus': order_status(order['items'])})}, session=session)
    return jsonify(message='Item cancelled and stock restored', order=jsonify_doc(db.orders.find_one({'_id': order_oid}))), 200


@shop_bp.patch('/orders/<order_id>/items/<int:idx>/ship')
@auth_required('artist')
@safe
def ship_item(order_id, idx):
    """Advance only the artist's active item through shipping states; do not decrement stock again."""
    denied = written()
    if denied:
        return denied
    data = obj(request.get_json(silent=True), {'status', 'trackingNumber'}, ('status', 'trackingNumber'))
    if not isinstance(data['status'], str) or data['status'] != 'shipped':
        raise BadInput('status must be shipped')
    tracking = string(data['trackingNumber'], 'trackingNumber', 100, 1)
    db = get_database()
    o = oid(order_id)
    with get_client().start_session() as session:
        with session.start_transaction():
            order = db.orders.find_one({'_id': o, 'items.productSnapshot.artistId': g.current_user['_id']}, session=session)
            if not order:
                return api_error('NOT_FOUND', 'Artist order not found', 404)
            if idx < 0 or idx >= len(order['items']):
                raise BadInput('Invalid order item index')
            item = order['items'][idx]
            if item['productSnapshot']['artistId'] != g.current_user['_id']:
                return api_error('FORBIDDEN', 'Not your order item', 403)
            if item['status'] != 'active':
                return api_error('CONFLICT', 'Cancelled items cannot be shipped', 409)
            if item['shipping']['status'] != 'pending':
                return api_error('CONFLICT', 'Only pending items can be marked shipped', 409)
            item['shipping']['status'] = 'shipped'
            item['shipping']['shippedAt'] = datetime.now(timezone.utc)
            item['shipping']['trackingNumber'] = tracking
            db.orders.update_one({'_id': o}, {'$set': stamp_update({'items': order['items'], 'orderStatus': order_status(order['items'])})}, session=session)
    return jsonify(order=jsonify_doc(db.orders.find_one({'_id': o}))), 200
