"""Read-only, admin-only MarketPulse analytics."""
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from flask import jsonify, request

from ...db import get_database, utc_now
from ...domain.validation import BadInput
from ...security import auth_required
from ..shop.common import LISTED_PRODUCT, jsonify_doc, safe
from .common import admin_bp

MAX_DAYS = 800
DAY = timedelta(days=1)
ZERO = Decimal('0.00')


def _window(args):
    try:
        start = date.fromisoformat(args.get('start', ''))
        end = date.fromisoformat(args.get('end', ''))
        if start.isoformat() != args.get('start') or end.isoformat() != args.get('end'):
            raise ValueError('Dates must use YYYY-MM-DD')
        days = (end - start).days + 1
        previous_date = start - timedelta(days=days)
        end_exclusive = end + DAY
        start_ms = int(args.get('startMs', ''))
        end_ms = int(args.get('endMs', ''))
        previous_ms = int(args.get('previousStartMs', ''))
        lo = datetime.fromtimestamp(start_ms / 1000, timezone.utc)
        hi = datetime.fromtimestamp(end_ms / 1000, timezone.utc)
        prev_lo = datetime.fromtimestamp(previous_ms / 1000, timezone.utc)
    except (ValueError, OverflowError, OSError):
        raise BadInput('Invalid MarketPulse date range')
    tz = args.get('timezone', '')
    if not 1 <= days <= MAX_DAYS or not tz or len(tz) > 100:
        raise BadInput('Invalid MarketPulse date range or timezone')
    # Local midnight can be on the adjacent UTC day, including across DST changes.
    boundaries = ((start, lo), (end_exclusive, hi), (previous_date, prev_lo))
    if not lo < hi or not prev_lo < lo or any(
        abs((instant - datetime.combine(day, datetime.min.time(), timezone.utc)).total_seconds()) > 86400
        for day, instant in boundaries
    ):
        raise BadInput('Invalid MarketPulse date boundaries')
    compare = args.get('compare', 'true')
    if compare not in ('true', 'false'):
        raise BadInput('compare must be true or false')
    return {
        'start': start, 'end': end, 'days': days, 'lo': lo, 'hi': hi,
        'prev_lo': prev_lo, 'timezone': tz, 'compare': compare == 'true',
    }


def _money(value):
    return value.to_decimal() if hasattr(value, 'to_decimal') else Decimal(str(value))


def _orders(db, window):
    lo = window['prev_lo'] if window['compare'] else window['lo']
    return db.orders.aggregate([
        {'$match': {'createdAt': {'$gte': lo, '$lt': window['hi']}}},
        {'$project': {
            'createdAt': 1, 'items': 1,
            'localDay': {'$dateToString': {
                'format': '%Y-%m-%d', 'date': '$createdAt',
                'timezone': window['timezone'],
            }},
        }},
    ])


def _utc(value):
    return value.replace(tzinfo=timezone.utc) if value.utcoffset() is None else value


def _period(window):
    previous_end = window['start'] - DAY
    return {
        'start': window['start'].isoformat(), 'end': window['end'].isoformat(),
        'previousStart': (window['start'] - timedelta(days=window['days'])).isoformat() if window['compare'] else None,
        'previousEnd': previous_end.isoformat() if window['compare'] else None,
    }


def _pair(current, previous, window):
    return {'current': current, 'previous': previous if window['compare'] else None}


def _collect_orders(db, window):
    periods = [[], []]
    for order in _orders(db, window):
        index = 0 if _utc(order['createdAt']) >= window['lo'] else 1
        periods[index].append(order)
    return periods


def _shipped(item):
    return item.get('status') == 'active' and item.get('shipping', {}).get('status') == 'shipped'


def _sales(orders):
    for order in orders:
        for item in order.get('items', []):
            if _shipped(item):
                yield order, item


def _amount(item):
    return _money(item['unitPrice']) * item['quantity']


def _growth_counts(db, orders, lo, hi):
    sales = list(_sales(orders))
    return {
        'totalRevenue': sum((_amount(item) for _, item in sales), ZERO),
        'commissionEarned': sum((_money(item['commissionAmount']) for _, item in sales), ZERO),
        'totalOrders': len({order['_id'] for order, _ in sales}),
        'totalCancellations': sum(item.get('status') == 'cancelled' for order in orders for item in order.get('items', [])),
        'newCustomers': db.users.count_documents({'role': 'customer', 'createdAt': {'$gte': lo, '$lt': hi}}),
        'newArtists': db.users.count_documents({'role': 'artist', 'artistProfile.onboardingStatus': 'approved', 'createdAt': {'$gte': lo, '$lt': hi}}),
    }


def _bucket(day, window, granularity):
    if granularity == 'month':
        return day.replace(day=1)
    if granularity == 'week':
        return window['start'] + timedelta(days=((day - window['start']).days // 7) * 7)
    return day


def _growth(db, window):
    current, previous = _collect_orders(db, window)
    cur = _growth_counts(db, current, window['lo'], window['hi'])
    prev = _growth_counts(db, previous, window['prev_lo'], window['lo']) if window['compare'] else {}
    granularity = 'day' if window['days'] <= 62 else 'week' if window['days'] <= 200 else 'month'
    buckets = {}
    day = window['start']
    while day <= window['end']:
        buckets.setdefault(_bucket(day, window, granularity).isoformat(), {'revenue': ZERO, 'commission': ZERO})
        day += DAY

    product_totals = {}
    for order, item in _sales(current):
        key = _bucket(date.fromisoformat(order['localDay']), window, granularity).isoformat()
        if key not in buckets:
            raise BadInput('Date boundaries do not match the supplied timezone')
        amount = _amount(item)
        commission = _money(item['commissionAmount'])
        buckets[key]['revenue'] += amount
        buckets[key]['commission'] += commission
        snapshot = item['productSnapshot']
        pid = item['productId']
        entry = product_totals.setdefault(pid, {
            'productId': pid, 'title': snapshot['title'], 'artistName': snapshot['artistName'],
            'imageUrl': snapshot.get('image'), 'unitsSold': 0, 'revenue': ZERO, 'commission': ZERO,
        })
        entry['unitsSold'] += item['quantity']
        entry['revenue'] += amount
        entry['commission'] += commission
    products = {p['_id']: p for p in db.products.find(
        {'_id': {'$in': list(product_totals)}}, {'category': 1}
    )}
    categories = defaultdict(lambda: ZERO)
    for pid, row in product_totals.items():
        row['category'] = products.get(pid, {}).get('category') or 'Unknown'
        categories[row['category']] += row['revenue']
    period = _period(window)
    period['granularity'] = granularity
    return {
        'period': period,
        'kpis': {key: _pair(value, prev.get(key), window) for key, value in cur.items()},
        'revenueSeries': [{'bucket': key, **values} for key, values in buckets.items()],
        'categoryRevenue': [{'category': key, 'revenue': value} for key, value in sorted(categories.items())],
        'topProducts': sorted(product_totals.values(), key=lambda row: (-row['unitsSold'], -row['revenue'], str(row['productId'])))[:5],
    }


def _artist_totals(orders):
    totals = {}
    for order, item in _sales(orders):
        snap = item['productSnapshot']
        row = totals.setdefault(snap['artistId'], {
            'artistId': snap['artistId'], 'name': snap['artistName'],
            'revenue': ZERO, 'commission': ZERO, 'orderIds': set(),
        })
        row['revenue'] += _amount(item)
        row['commission'] += _money(item['commissionAmount'])
        row['orderIds'].add(order['_id'])
    return totals


def _last_sales(db):
    return {row['_id']: _utc(row['lastSoldAt']) for row in db.orders.aggregate([
        {'$match': {'createdAt': {'$type': 'date'}}},
        {'$unwind': '$items'},
        {'$match': {'items.status': 'active', 'items.shipping.status': 'shipped'}},
        {'$group': {'_id': '$items.productId', 'lastSoldAt': {'$max': '$createdAt'}}},
    ])}


def _performance(db, window):
    current, previous = _collect_orders(db, window)
    artists = _artist_totals(current)
    old_artists = _artist_totals(previous)
    listed = list(db.products.find({**LISTED_PRODUCT, 'active': True}, {
        'title': 1, 'artistId': 1, 'images': 1, 'inventory.quantityAvailable': 1,
    }))
    names = {u['_id']: ' '.join(filter(None, [
        u.get('personalInfo', {}).get('firstName'), u.get('personalInfo', {}).get('lastName'),
    ])) or 'Unknown artist' for u in db.users.find(
        {'_id': {'$in': list({p['artistId'] for p in listed})}}, {'personalInfo': 1}
    )}
    reviews = list(db.reviews.find({
        'active': {'$ne': False}, 'createdAt': {'$gte': window['prev_lo'] if window['compare'] else window['lo'], '$lt': window['hi']},
    }, {'productId': 1, 'rating': 1, 'createdAt': 1}))
    cur_reviews = [r for r in reviews if _utc(r['createdAt']) >= window['lo']]
    prev_reviews = [r for r in reviews if _utc(r['createdAt']) < window['lo']]
    sold = defaultdict(int)
    for _, item in _sales(current):
        sold[item['productId']] += item['quantity']
    ratings = defaultdict(list)
    for review in cur_reviews:
        ratings[review['productId']].append(review['rating'])
    now = utc_now()
    last_sales = _last_sales(db)
    slow = []
    no_recent = []
    for product in listed:
        last = last_sales.get(product['_id'])
        if last is None or last < now - timedelta(days=30):
            no_recent.append({'productId': product['_id'], 'title': product['title']})
        inventory = product.get('inventory', {}).get('quantityAvailable', 0)
        if inventory > 0 and (last is None or last < now - timedelta(days=60)):
            slow.append({
                'productId': product['_id'], 'title': product['title'],
                'imageUrl': (product.get('images') or [None])[0],
                'artistName': names.get(product['artistId'], 'Unknown artist'),
                'inventory': inventory, 'lastSoldAt': last,
                'daysSinceSale': (now - last).days if last else None,
            })
    slow.sort(key=lambda p: (p['daysSinceSale'] is not None, -(p['daysSinceSale'] or 0), -p['inventory'], p['title']))
    sold_units = sorted(sold.get(p['_id'], 0) for p in listed if sold.get(p['_id'], 0) > 0)
    threshold = sold_units[len(sold_units) // 2] if sold_units else 0
    poor = []
    for product in listed:
        pid = product['_id']
        values = ratings.get(pid, [])
        if values and sold[pid] > 0 and sold[pid] >= threshold and sum(values) / len(values) < 3.5:
            poor.append({'productId': pid, 'title': product['title'], 'unitsSold': sold[pid], 'averageRating': round(sum(values) / len(values), 2)})
    declining = []
    if window['compare']:
        for aid, old in old_artists.items():
            revenue = artists.get(aid, {}).get('revenue', ZERO)
            if old['revenue'] > 0 and revenue < old['revenue'] * Decimal('0.8'):
                declining.append({
                    'artistId': aid, 'name': old['name'], 'revenue': revenue,
                    'previousRevenue': old['revenue'],
                    'changePct': round((revenue - old['revenue']) * 100 / old['revenue']),
                })
    top = sorted(artists.values(), key=lambda p: (-p['revenue'], str(p['artistId'])))[:5]
    return {
        'period': _period(window),
        'kpis': {
            'activeArtists': _pair(len(artists), len(old_artists), window),
            'totalProducts': {'current': len(listed), 'previous': None},
            'totalReviews': _pair(len(cur_reviews), len(prev_reviews), window),
            'productsWithoutSales': {'current': sum(sold.get(p['_id'], 0) == 0 for p in listed), 'previous': None},
        },
        'topArtists': [{**{k: v for k, v in row.items() if k != 'orderIds'}, 'orders': len(row['orderIds'])} for row in top],
        'slowMovers': slow,
        'attention': {
            'decliningArtists': declining, 'noSalesLast30Days': no_recent,
            'highSalesPoorRated': poor,
            'pendingApprovals': db.users.count_documents({'role': 'artist', 'artistProfile.onboardingStatus': {'$in': ['request_received', 'waiting_for_documents', 'received_documents']}}),
        },
    }


@admin_bp.get('/analytics/growth')
@auth_required('admin')
@safe
def marketpulse_growth():
    return jsonify(jsonify_doc(_growth(get_database(), _window(request.args)))), 200


@admin_bp.get('/analytics/performance')
@auth_required('admin')
@safe
def marketpulse_performance():
    return jsonify(jsonify_doc(_performance(get_database(), _window(request.args)))), 200
