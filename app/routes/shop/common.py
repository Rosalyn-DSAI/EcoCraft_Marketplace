"""Shared blueprint, request parsing and seed-policy helpers for the marketplace API."""
from datetime import datetime
from decimal import Decimal
from functools import wraps

from bson import Decimal128, ObjectId
from flask import Blueprint, current_app, g
from pymongo.errors import DuplicateKeyError, PyMongoError

from ...domain.validation import BadInput
from ...security import api_error, can_edit_user, require_write_enabled

shop_bp = Blueprint('shop', __name__)


def safe(fn):
    """Convert expected input/database exceptions to predictable JSON without leaking details."""
    @wraps(fn)
    def wrapped(*a, **k):
        try:
            return fn(*a, **k)
        except BadInput as exc:
            return api_error('VALIDATION_ERROR', str(exc), 400)
        except DuplicateKeyError:
            return api_error('DUPLICATE', 'A matching record already exists', 409)
        except (PyMongoError, ValueError):
            current_app.logger.exception('Marketplace operation failed')
            return api_error('DATABASE_UNAVAILABLE', 'MongoDB operation could not be completed', 503)
    return wrapped


def oid(raw):
    """Convert a client-supplied identifier to ObjectId, reporting malformed IDs as input errors."""
    if not isinstance(raw, str) or not ObjectId.is_valid(raw):
        raise BadInput('Invalid MongoDB ObjectId')
    return ObjectId(raw)


def jsonify_doc(value):
    """Serialize BSON IDs, money and dates recursively while withholding passwordHash."""
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, Decimal128):
        return format(value.to_decimal(), '.2f')
    if isinstance(value, Decimal):
        return format(value, '.2f')
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, list):
        return [jsonify_doc(v) for v in value]
    if isinstance(value, dict):
        return {k: jsonify_doc(v) for k, v in value.items() if k != 'passwordHash'}
    return value


def written():
    """Combine write opt-in with caller eligibility; this gate never replaces record ownership checks."""
    denied = require_write_enabled()
    if denied is not None:
        return denied
    if not can_edit_user(g.current_user):
        return api_error('SEEDED_RECORD_PROTECTED', 'Original seed accounts cannot perform demo writes', 403)
    return None


def demo_artist(db, artist_id):
    """Check whether the product owner is an eligible artist under the configured seed policy."""
    user = db.users.find_one({'_id': artist_id, 'role': 'artist'})
    return user is not None and can_edit_user(user)


def demo_product(db, doc):
    """Require an existing product whose owning artist passes the seed-eligibility policy."""
    return bool(doc and demo_artist(db, doc['artistId']))


def add_rating_summaries(db, products):
    """Attach averageRating and reviewCount using one aggregation limited to the returned product IDs."""
    ids = [p['_id'] for p in products]
    summaries = {}
    if ids:
        pipeline = [
            {'$match': {'productId': {'$in': ids}, 'active': {'$ne': False}}},
            {'$group': {'_id': '$productId', 'averageRating': {'$avg': '$rating'}, 'reviewCount': {'$sum': 1}}},
        ]
        summaries = {r['_id']: r for r in db.reviews.aggregate(pipeline)}
    for p in products:
        s = summaries.get(p['_id'])
        p['averageRating'] = round(s['averageRating'], 1) if s else None
        p['reviewCount'] = s['reviewCount'] if s else 0
    return products


LISTED_PRODUCT = {'approvalStatus': 'approved', 'listProduct': True, 'active': {'$ne': False}}
ELIGIBLE_ARTIST = {'role': 'artist', 'artistProfile.onboardingStatus': 'approved', 'active': {'$ne': False}}


def eligible_artist_ids(db):
    """Return IDs of artists whose approved products may be shown in browse, categories and the cart."""
    return [u['_id'] for u in db.users.find(ELIGIBLE_ARTIST, {'_id': 1})]


def artist_is_eligible(db, artist_id, session=None):
    """Check one artist against the same visibility rule used by eligible_artist_ids()."""
    return db.users.count_documents({'_id': artist_id, **ELIGIBLE_ARTIST}, limit=1, session=session) == 1
