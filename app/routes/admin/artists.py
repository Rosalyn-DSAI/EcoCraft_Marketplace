"""Read-only admin artist listing; approval mutations are in moderation.py."""
from flask import jsonify, request
from pymongo.errors import PyMongoError
import re

from ...db import get_database
from ...security import api_error, auth_required, public_user
from .common import admin_bp

STATUSES = {"request_received", "waiting_for_documents", "received_documents", "approved", "rejected"}


@admin_bp.get("/artists")
@auth_required("admin")
def artist_requests():
    """List onboarding profiles for admins with status filter, name/email search, paging and optional name order."""
    status = request.args.get("status")
    if status and status not in STATUSES:
        return api_error("VALIDATION_ERROR", "Unknown onboarding status", 400)
    page_arg = request.args.get("page", "1")
    if not page_arg.isdecimal() or not (1 <= int(page_arg) <= 1000):
        return api_error("VALIDATION_ERROR", "page must be between 1 and 1000", 400)
    size_arg = request.args.get("pageSize", "20")
    if not size_arg.isdecimal() or not (1 <= int(size_arg) <= 50):
        return api_error("VALIDATION_ERROR", "pageSize must be between 1 and 50", 400)
    page, page_size = int(page_arg), int(size_arg)
    sort_by_name = request.args.get("sort") == "name"
    query = request.args.get("q", "").strip()[:100]
    filter_doc = {"role": "artist"}
    if status:
        filter_doc["artistProfile.onboardingStatus"] = status
    if query:
        pattern = {"$regex": re.escape(query), "$options": "i"}
        filter_doc["$or"] = [{"personalInfo.firstName": pattern}, {"personalInfo.lastName": pattern}, {"email": pattern}]
    order = [("personalInfo.firstName", 1), ("personalInfo.lastName", 1), ("_id", 1)] if sort_by_name else [("_id", -1)]
    try:
        users = get_database().users
        total = users.count_documents(filter_doc)
        docs = users.find(filter_doc).sort(order).skip((page - 1) * page_size).limit(page_size)
        artists = [public_user(user) for user in docs]
    except PyMongoError:
        return api_error("DATABASE_UNAVAILABLE", "Could not list artists", 503)
    return jsonify(artists=artists, page=page, pageSize=page_size, total=total), 200
