"""Sustainability profile validation: approved practices, summary and certifications."""
import re

from .validation import BadInput, obj, string

SUSTAINABILITY_PRACTICES = frozenset({'recycled_materials', 'upcycled', 'organic', 'locally_sourced', 'zero_waste_packaging', 'handmade_small_batch', 'non_toxic_finishes'})


def parse_sustainability(data, admin=False):
    """Validate the artist-declared sustainability profile; only admins may mark certifications verified."""
    v = obj(data, {'practices', 'summary', 'certifications'})
    result = {}
    if 'practices' in v:
        practices = v['practices']
        if (not isinstance(practices, list) or len(practices) > len(SUSTAINABILITY_PRACTICES)
                or any(not isinstance(p, str) or p not in SUSTAINABILITY_PRACTICES for p in practices)
                or len(set(practices)) != len(practices)):
            raise BadInput('sustainability.practices must be unique values from the approved list')
        result['practices'] = list(practices)
    if 'summary' in v:
        result['summary'] = string(v['summary'], 'sustainability.summary', 500, 0)
    if 'certifications' in v:
        certifications = v['certifications']
        if not isinstance(certifications, list) or len(certifications) > 10:
            raise BadInput('sustainability.certifications must be an array with at most 10 items')
        result['certifications'] = [parse_certification(c, admin) for c in certifications]
    return result


def parse_certification(data, admin=False):
    """Certifications start unverified; only an admin can set verified."""
    fields = {'name', 'issuer', 'certificateUrl', 'verified'} if admin else {'name', 'issuer', 'certificateUrl'}
    v = obj(data, fields, ('name', 'issuer'))
    result = {'name': string(v['name'], 'certification name', 100),
              'issuer': string(v['issuer'], 'certification issuer', 100),
              'verified': False}
    if 'certificateUrl' in v:
        url = string(v['certificateUrl'], 'certificateUrl', 1024)
        if not re.fullmatch(r'https://\S+', url):
            raise BadInput('certificateUrl must start with https://')
        result['certificateUrl'] = url
    if admin and 'verified' in v:
        if type(v['verified']) is not bool:
            raise BadInput('verified must be true or false')
        result['verified'] = v['verified']
    return result
