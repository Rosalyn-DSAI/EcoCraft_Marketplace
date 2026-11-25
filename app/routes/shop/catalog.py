"""Public catalog reads: approved product browsing, category aggregation and maker cards."""
import math
import re
from collections import Counter
from datetime import datetime, timedelta, timezone

from bson import ObjectId
from flask import jsonify, request

from ...db import get_database
from ...domain.sustainability import SUSTAINABILITY_PRACTICES
from ...domain.validation import BadInput
from .common import ELIGIBLE_ARTIST, add_rating_summaries, eligible_artist_ids, jsonify_doc, safe, shop_bp, LISTED_PRODUCT

MAKER_DEFAULT_LIMIT = 10
MULTI_VALUE_LIMITS = {'category': 30, 'material': 15, 'practice': 7}
MAKER_MAX_LIMIT = 100
SALES_WINDOW = timedelta(days=30)
MAX_PRICE = 1_000_000
SORT_ORDERS = {
    'newest': [('_id', -1)],
    'price_asc': [('price', 1), ('_id', -1)],
    'price_desc': [('price', -1), ('_id', -1)],
}
OBJECT_ID_PATTERN = re.compile(r'[0-9a-fA-F]{24}')


def query_page():
    """Parse bounded ASCII pagination; callers raise the returned BadInput on invalid input."""
    page = request.args.get('page', '1')
    if not (page.isascii() and page.isdigit()) or not 1 <= int(page) <= 100:
        return BadInput('page must be between 1 and 100')
    return int(page)


def price_bound(name):
    """Return an optional non-negative price bound from the query string."""
    raw = request.args.get(name, '').strip()
    if not raw:
        return None
    try:
        value = float(raw)
    except ValueError:
        raise BadInput(f'{name} must be a number')
    if not math.isfinite(value) or not 0 <= value <= MAX_PRICE:
        raise BadInput(f'{name} must be between 0 and {MAX_PRICE}')
    return value


def multi_values(name):
    """Return repeated query values for a filter, bounded in count and length."""
    values = [v.strip() for v in request.args.getlist(name) if v.strip()]
    if len(values) > MULTI_VALUE_LIMITS[name] or any(len(v) > 100 for v in values):
        raise BadInput(f'{name} filter is too long')
    if name == 'practice' and any(v not in SUSTAINABILITY_PRACTICES for v in values):
        raise BadInput('practice is not supported')
    return values


@shop_bp.get('/products')
@safe
def browse():
    """Read only approved/listed products; escape search text before constructing regex filters."""
    page = query_page()
    if isinstance(page, BadInput):
        raise page
    term = request.args.get('search', '').strip()
    categories = multi_values('category')
    materials = multi_values('material')
    practices = multi_values('practice')
    artist = request.args.get('artistId', '').strip()
    sort = request.args.get('sort', 'newest')
    if len(term) > 80:
        raise BadInput('Search is too long')
    if sort not in SORT_ORDERS:
        raise BadInput('sort is not supported')
    min_price, max_price = price_bound('minPrice'), price_bound('maxPrice')
    if min_price is not None and max_price is not None and min_price > max_price:
        raise BadInput('minPrice cannot be greater than maxPrice')
    db = get_database()
    artists = eligible_artist_ids(db)
    if artist:
        if not OBJECT_ID_PATTERN.fullmatch(artist):
            raise BadInput('artistId is invalid')
        artists = [a for a in artists if a == ObjectId(artist)]
    query = {**LISTED_PRODUCT, 'inventory.quantityAvailable': {'$gt': 0}, 'artistId': {'$in': artists}}
    if term:
        query['$or'] = [{'title': {'$regex': re.escape(term), '$options': 'i'}}, {'description': {'$regex': re.escape(term), '$options': 'i'}}, {'tags': {'$regex': re.escape(term), '$options': 'i'}}]
    if categories:
        query['category'] = {'$in': categories}
    if materials:
        query['materials'] = {'$in': materials}
    if practices:
        query['sustainability.practices'] = {'$in': practices}
    if min_price is not None or max_price is not None:
        query['price'] = {k: v for k, v in (('$gte', min_price), ('$lte', max_price)) if v is not None}
    products = list(db.products.find(query).sort(SORT_ORDERS[sort]).skip((page - 1) * 20).limit(20))
    add_rating_summaries(db, products)
    return jsonify(products=jsonify_doc(products), page=page, pageSize=20), 200


@shop_bp.get('/analytics/categories')
@safe
def category_aggregation():
    """Genuine MongoDB aggregation pipeline, not Python-side grouping."""
    db = get_database()
    match = {**LISTED_PRODUCT, 'inventory.quantityAvailable': {'$gt': 0}, 'artistId': {'$in': eligible_artist_ids(db)}}
    pipeline = [{'$match': match}, {'$group': {'_id': '$category', 'productCount': {'$sum': 1}, 'averagePrice': {'$avg': '$price'}}}, {'$sort': {'productCount': -1, '_id': 1}}, {'$limit': 30}]
    docs = db.products.aggregate(pipeline)
    return jsonify(categories=jsonify_doc([{'category': v['_id'], 'productCount': v['productCount'], 'averagePrice': v.get('averagePrice')} for v in docs])), 200


@shop_bp.get('/analytics/materials')
@safe
def material_aggregation():
    """Distinct listed materials, most used first, for the Shop by checklist."""
    db = get_database()
    match = {**LISTED_PRODUCT, 'inventory.quantityAvailable': {'$gt': 0}, 'artistId': {'$in': eligible_artist_ids(db)}}
    pipeline = [{'$match': match}, {'$unwind': '$materials'}, {'$group': {'_id': '$materials', 'productCount': {'$sum': 1}}}, {'$sort': {'productCount': -1, '_id': 1}}, {'$limit': 40}]
    docs = db.products.aggregate(pipeline)
    return jsonify(materials=[v['_id'] for v in docs]), 200


@shop_bp.get('/artists/makers')
@safe
def maker_cards():
    """Public artist cards: only approved artists with a listed, in-stock product; no contact or account fields."""
    raw_limit = request.args.get('limit', str(MAKER_DEFAULT_LIMIT))
    if not (raw_limit.isascii() and raw_limit.isdigit()) or not 1 <= int(raw_limit) <= MAKER_MAX_LIMIT:
        raise BadInput(f'limit must be between 1 and {MAKER_MAX_LIMIT}')
    db = get_database()
    match = {**LISTED_PRODUCT, 'inventory.quantityAvailable': {'$gt': 0}, 'artistId': {'$in': eligible_artist_ids(db)}}
    groups = list(db.products.aggregate([
        {'$match': match},
        {'$sort': {'_id': -1}},
        {'$group': {'_id': '$artistId', 'image': {'$first': {'$arrayElemAt': [{'$ifNull': ['$images', []]}, 0]}}, 'productIds': {'$push': '$_id'}, 'latest': {'$max': '$_id'}}},
        {'$sort': {'latest': -1}},
        {'$limit': int(raw_limit)},
    ]))
    if not groups:
        return jsonify(makers=[]), 200
    artist_ids = [g['_id'] for g in groups]
    product_ids = [pid for g in groups for pid in g['productIds']]
    artist_of_product = {pid: g['_id'] for g in groups for pid in g['productIds']}
    artists = {a['_id']: a for a in db.users.find({'_id': {'$in': artist_ids}, **ELIGIBLE_ARTIST}, {'personalInfo.firstName': 1, 'personalInfo.lastName': 1, 'artistProfile.originStory': 1})}

    in_carts = Counter()
    for cart in db.cart.aggregate([
        {'$unwind': '$items'},
        {'$match': {'items.productId': {'$in': product_ids}}},
        {'$group': {'_id': '$_id', 'productIds': {'$addToSet': '$items.productId'}}},
    ]):
        for artist_id in {artist_of_product[pid] for pid in cart['productIds']}:
            in_carts[artist_id] += 1

    since = datetime.now(timezone.utc) - SALES_WINDOW
    sold = {v['_id']: v['units'] for v in db.orders.aggregate([
        {'$unwind': '$items'},
        {'$match': {'items.status': 'active', 'items.productSnapshot.artistId': {'$in': artist_ids}, 'createdAt': {'$gte': since}}},
        {'$group': {'_id': '$items.productSnapshot.artistId', 'units': {'$sum': '$items.quantity'}}},
    ])}

    makers = []
    for group in groups:
        artist = artists.get(group['_id'])
        if artist is None:
            continue
        info = artist.get('personalInfo', {})
        makers.append({
            'id': str(group['_id']),
            'name': f"{info.get('firstName', '')} {info.get('lastName', '')}".strip(),
            'originStory': (artist.get('artistProfile') or {}).get('originStory') or '',
            'image': group.get('image') or None,
            'inCarts': in_carts[group['_id']],
            'soldLast30Days': sold.get(group['_id'], 0),
        })
    return jsonify(makers=makers), 200
