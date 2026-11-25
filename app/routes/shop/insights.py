"""Artist sales insights: KPI and top-product summaries over bounded, same-length comparison windows."""
from datetime import datetime, timezone
from decimal import Decimal

from bson import ObjectId
from flask import g, jsonify, request

from ...db import get_database
from ...domain.orders import order_status
from ...domain.validation import BadInput
from ...security import auth_required
from .common import safe, shop_bp

INSIGHTS_MAX_SPAN_MS = 800 * 24 * 3600 * 1000


def insights_window(args):
    """Read a [start,end) window in epoch milliseconds, bounded so one request cannot scan unlimited history."""
    try:
        start, end = int(args.get('start', '')), int(args.get('end', ''))
    except ValueError:
        raise BadInput('start and end must be epoch milliseconds')
    if end <= start or end - start > INSIGHTS_MAX_SPAN_MS:
        raise BadInput('Invalid insights window')
    return start, end


def artist_orders_in(db, artist_id, lo, hi):
    """Group the artist's own order items by order for orders placed in [lo,hi); the order _id carries its placement time."""
    pipeline = [
        {'$match': {'_id': {'$gte': ObjectId.from_datetime(lo), '$lt': ObjectId.from_datetime(hi)}, 'items.productSnapshot.artistId': artist_id}},
        {'$unwind': '$items'},
        {'$match': {'items.productSnapshot.artistId': artist_id}},
        {'$project': {'_id': 1, 'item': '$items'}},
    ]
    orders = {}
    for row in db.orders.aggregate(pipeline):
        orders.setdefault(row['_id'], []).append(row['item'])
    return orders


def summarize_insights(orders):
    """Compute the artist's KPIs from live items only; cancelled items never count toward sales, commission or payout."""
    kpi = {'grossSales': Decimal('0'), 'commission': Decimal('0'), 'netPayout': Decimal('0'), 'orders': 0}
    statuses = {'Shipped': 0, 'Pending': 0, 'Cancelled': 0}
    products = {}
    for items in orders.values():
        # order_status maps to: cancelled, shipped, or pending/partially_shipped.
        state = {'cancelled': 'Cancelled', 'shipped': 'Shipped'}.get(order_status(items), 'Pending')
        statuses[state] += 1
        if state == 'Cancelled':
            continue
        kpi['orders'] += 1
        for item in items:
            if item['status'] != 'active':
                continue
            qty = item['quantity']
            gross = item['unitPrice'].to_decimal() * qty
            commission = item['commissionAmount'].to_decimal()
            net = item['artistPayout'].to_decimal()
            kpi['grossSales'] += gross
            kpi['commission'] += commission
            kpi['netPayout'] += net
            pid = str(item['productId'])
            p = products.setdefault(pid, {'productId': pid, 'title': item['productSnapshot']['title'], 'unitsSold': 0, 'grossSales': Decimal('0'), 'netPayout': Decimal('0')})
            p['unitsSold'] += qty
            p['grossSales'] += gross
            p['netPayout'] += net
    ranked = sorted(products.values(), key=lambda p: p['grossSales'], reverse=True)
    return {
        'kpis': {'grossSales': format(kpi['grossSales'], '.2f'), 'commission': format(kpi['commission'], '.2f'), 'netPayout': format(kpi['netPayout'], '.2f'), 'orders': kpi['orders']},
        'statusCounts': statuses,
        'topProducts': [{**p, 'grossSales': format(p['grossSales'], '.2f'), 'netPayout': format(p['netPayout'], '.2f')} for p in ranked],
    }


@shop_bp.get('/orders/insights')
@auth_required('artist')
@safe
def artist_insights():
    """Summarize only the caller's own order items for the requested window and the equal-length window before it."""
    start, end = insights_window(request.args)
    lo = datetime.fromtimestamp(start / 1000, timezone.utc)
    hi = datetime.fromtimestamp(end / 1000, timezone.utc)
    prev_lo = datetime.fromtimestamp((2 * start - end) / 1000, timezone.utc)
    db = get_database()
    artist_id = g.current_user['_id']
    current = summarize_insights(artist_orders_in(db, artist_id, lo, hi))
    previous = summarize_insights(artist_orders_in(db, artist_id, prev_lo, lo))
    return jsonify(period={'start': start, 'end': end}, current=current['kpis'], previous=previous['kpis'], statusCounts=current['statusCounts'], topProducts=current['topProducts']), 200
