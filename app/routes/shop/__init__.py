"""Marketplace API blueprint, assembled from functional modules.

Importing each module registers its routes on the shared ``shop_bp`` blueprint.
"""
from . import artist_products, cart, catalog, insights, orders, reviews  # noqa: F401
from .common import shop_bp

__all__ = ['shop_bp']
