"""Product validation (fields, images, tags) and commission-rate rules."""
import re
from decimal import Decimal, InvalidOperation

from .sustainability import parse_sustainability
from .validation import BadInput, money, obj, string, whole


def rate(value):
    """Validate a commission percentage from 0 to 100, rather than a fractional multiplier."""
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise BadInput('commissionRate must be between 0 and 100')
    try:
        n = Decimal(str(value))
    except InvalidOperation:
        raise BadInput('commissionRate must be between 0 and 100') from None
    if not n.is_finite() or not Decimal(0) <= n <= Decimal(100) or n.as_tuple().exponent < -2:
        raise BadInput('commissionRate must be between 0 and 100 with at most 2 decimal places')
    return int(n) if n == int(n) else float(n)


def parse_product(data, partial=False):
    """Validate allowed product fields; partial updates use dotted inventory paths for MongoDB."""
    fields = {'title','description','price','category','materials','quantityAvailable','dimensions','careInstructions','tags','images','sustainability','copyrightText','returnPolicy'}
    obj(data, fields, () if partial else ('title','description','price','category','materials','quantityAvailable'))
    if partial and not data:
        raise BadInput('At least one product field is required')
    result = {}
    for field, limit in [('title',120),('description',3000),('category',100),('dimensions',200),('careInstructions',1000),('copyrightText',500),('returnPolicy',1000)]:
        if field in data:
            result[field] = string(data[field], field, limit, 0 if field in {'dimensions','careInstructions','copyrightText','returnPolicy'} else 1)
    if 'price' in data:
        result['price'] = money(data['price'])
    if 'quantityAvailable' in data:
        result['inventory.quantityAvailable' if partial else 'inventory'] = (whole(data['quantityAvailable'],'quantityAvailable',0,100000) if partial else {'quantityAvailable':whole(data['quantityAvailable'],'quantityAvailable',0,100000)})
    for name, maximum in [('materials',15),('tags',20),('images',8)]:
        if name in data:
            items=data[name]
            if not isinstance(items,list) or len(items)>maximum or (name=='materials' and not items):
                raise BadInput(f'{name} must be an array of 1-{maximum} items' if name=='materials' else f'{name} must be an array with at most {maximum} items')
            if name=='images':
                for item in items:
                    string(item,'image URL',1024)
                    if not re.fullmatch(r'https://[^\s]+',item):
                        raise BadInput('Image URLs must start with https://')
                result[name]=items
            else:
                result[name]=[string(v,name,100) for v in items]
    if 'sustainability' in data:
        result['sustainability'] = parse_sustainability(data['sustainability'])
    return result
