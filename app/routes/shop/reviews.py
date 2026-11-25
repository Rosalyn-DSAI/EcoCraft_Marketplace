"""Product reviews: public listing, verified-purchase creation, and owner edit/soft-delete."""
from bson import ObjectId
from flask import g, jsonify, request

from ...db import get_database, stamp_insert, stamp_update
from ...domain.validation import BadInput, obj, string, whole
from ...security import api_error, auth_required
from .common import demo_product, jsonify_doc, oid, safe, shop_bp, written


@shop_bp.get('/products/<item_id>/reviews')
@safe
def product_reviews(item_id):
    """Read a bounded public review list for a valid product identifier."""
    docs = get_database().reviews.find({'productId': oid(item_id), 'active': {'$ne': False}}).sort('_id', -1).limit(100)
    return jsonify(reviews=jsonify_doc(list(docs))), 200


@shop_bp.post('/reviews')
@auth_required('customer')
@safe
def add_review():
    """Create a verified review for the customer's active, shipped order item; unique index prevents duplicates."""
    denied = written()
    if denied:
        return denied
    data = obj(request.get_json(silent=True), {'productId', 'orderId', 'rating', 'comment'}, ('productId', 'orderId', 'rating', 'comment'))
    pid = oid(data['productId'])
    order_id = oid(data['orderId'])
    rating = whole(data['rating'], 'rating', 1, 5)
    db = get_database()
    order = db.orders.find_one({'_id': order_id, 'customerId': g.current_user['_id']})
    if not order or not any(i['productId'] == pid and i['status'] == 'active' and i['shipping']['status'] == 'shipped' for i in order['items']):
        return api_error('NOT_VERIFIED', 'A shipped, active order item is required for reviews', 403)
    prod = db.products.find_one({'_id': pid, 'active': {'$ne': False}})
    if not demo_product(db, prod):
        return api_error('SEEDED_RECORD_PROTECTED', 'Reviews are limited to fresh demo products', 403)
    if db.reviews.find_one({'customerId': g.current_user['_id'], 'productId': pid, 'orderId': order_id, 'active': {'$ne': False}}):
        return api_error('DUPLICATE', 'You have already reviewed this item', 409)
    doc = {'_id': ObjectId(), 'productId': pid, 'customerId': g.current_user['_id'], 'orderId': order_id, 'rating': rating, 'active': True}
    doc['comment'] = string(data['comment'], 'comment', 1000, 0)
    db.reviews.insert_one(stamp_insert(doc))
    return jsonify(review=jsonify_doc(doc)), 201


@shop_bp.patch('/reviews/<review_id>')
@auth_required('customer')
@safe
def edit_review(review_id):
    """Update only the caller's eligible review, allowing rating/comment fields."""
    denied = written()
    if denied:
        return denied
    data = obj(request.get_json(silent=True), {'rating', 'comment'})
    if not data:
        raise BadInput('Supply rating or comment')
    db = get_database()
    doc = db.reviews.find_one({'_id': oid(review_id), 'customerId': g.current_user['_id'], 'active': {'$ne': False}})
    if not doc:
        return api_error('NOT_FOUND', 'Review not found', 404)
    if not demo_product(db, db.products.find_one({'_id': doc['productId']})):
        return api_error('SEEDED_RECORD_PROTECTED', 'Original reviews cannot be modified', 403)
    changes = {}
    if 'rating' in data:
        changes['rating'] = whole(data['rating'], 'rating', 1, 5)
    if 'comment' in data:
        changes['comment'] = string(data['comment'], 'comment', 1000, 0)
    db.reviews.update_one({'_id': doc['_id'], 'customerId': g.current_user['_id']}, {'$set': stamp_update(changes)})
    return jsonify(review=jsonify_doc(db.reviews.find_one({'_id': doc['_id']}))), 200


@shop_bp.delete('/reviews/<review_id>')
@auth_required('customer')
@safe
def delete_review(review_id):
    """Remove only the caller's eligible review while preserving original seeded reviews."""
    denied = written()
    if denied:
        return denied
    db = get_database()
    doc = db.reviews.find_one({'_id': oid(review_id), 'customerId': g.current_user['_id'], 'active': {'$ne': False}})
    if not doc:
        return api_error('NOT_FOUND', 'Review not found', 404)
    if not demo_product(db, db.products.find_one({'_id': doc['productId']})):
        return api_error('SEEDED_RECORD_PROTECTED', 'Original review records are protected', 403)
    db.reviews.update_one({'_id': doc['_id'], 'customerId': g.current_user['_id']}, {'$set': stamp_update({'active': False})})
    return jsonify(message='Review removed'), 200
