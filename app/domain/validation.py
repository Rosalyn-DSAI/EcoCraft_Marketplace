"""Shared validation primitives for marketplace input. Framework-free and database-free."""
from decimal import Decimal, InvalidOperation

MONEY = Decimal('0.01')


class BadInput(ValueError):
    pass


def obj(value, fields=None, required=()):
    """Require an object, reject fields outside the allowlist, and enforce required keys."""
    if not isinstance(value, dict):
        raise BadInput('A JSON object is required')
    if fields is not None and set(value) - set(fields):
        raise BadInput('Unknown fields: ' + ', '.join(sorted(set(value)-set(fields))))
    if any(field not in value for field in required):
        raise BadInput('Missing required fields: ' + ', '.join(k for k in required if k not in value))
    return value


def string(value, name, max_length=200, min_length=1):
    """Trim a string and enforce its field-specific length bounds."""
    if not isinstance(value, str) or not min_length <= len(value.strip()) <= max_length:
        raise BadInput(f'{name} must contain {min_length}-{max_length} characters')
    return value.strip()


def whole(value, name, minimum=0, maximum=100000):
    """Validate an integer in range; reject booleans even though Python treats them as integers."""
    if type(value) is not int or not minimum <= value <= maximum:
        raise BadInput(f'{name} must be a whole number from {minimum} to {maximum}')
    return value


def money(value, name='price', allow_zero=False):
    """Return an exact two-decimal price; BSON conversion belongs to the persistence layer."""
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        raise BadInput(f'{name} must be a valid price')
    try:
        n = Decimal(str(value))
    except InvalidOperation:
        raise BadInput(f'{name} must be a valid price') from None
    if not n.is_finite() or n < (Decimal('0') if allow_zero else MONEY) or n > Decimal('9999999.99') or n != n.quantize(MONEY):
        raise BadInput(f'{name} must be a nonnegative amount with at most 2 decimal places')
    return n.quantize(MONEY)
