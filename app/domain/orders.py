"""Order money math, fulfillment status and shipping-address validation."""
from decimal import Decimal, ROUND_HALF_UP

from .validation import MONEY, obj, string


def parse_address(data):
    """Require and normalize the five shipping-address fields used by order documents."""
    fields=('street','city','state','zipCode','country')
    obj(data, fields, fields)
    return {k:string(data[k],k,120) for k in fields}


def amounts(unit_price, quantity, commission_rate):
    """Compute subtotal, percentage commission and payout with explicit currency rounding."""
    subtotal=(unit_price * quantity).quantize(MONEY, rounding=ROUND_HALF_UP)
    commission=(subtotal * Decimal(str(commission_rate))/100).quantize(MONEY, rounding=ROUND_HALF_UP)
    return subtotal,commission,(subtotal-commission).quantize(MONEY)


def order_totals(items):
    """Sum active order items only; cancelled items no longer contribute to totals."""
    subtotal=commission=payout=Decimal('0.00')
    for item in items:
        if item['status']!='active':
            continue
        price=item['unitPrice'].to_decimal() if hasattr(item['unitPrice'],'to_decimal') else Decimal(str(item['unitPrice']))
        a,b,c=amounts(price,item['quantity'],item['commissionRate'])
        subtotal+=a; commission+=b; payout+=c
    return dict(subtotal=subtotal.quantize(MONEY),commissionTotal=commission.quantize(MONEY),totalAmount=subtotal.quantize(MONEY),artistPayoutTotal=payout.quantize(MONEY))


def order_status(items):
    """Derive overall fulfillment from active items; all cancelled means cancelled."""
    live=[v for v in items if v['status']=='active']
    if not live:return 'cancelled'
    s=[v['shipping']['status'] for v in live]
    if all(x=='shipped' for x in s):return 'shipped'
    if any(x=='shipped' for x in s):return 'partially_shipped'
    return 'pending'
