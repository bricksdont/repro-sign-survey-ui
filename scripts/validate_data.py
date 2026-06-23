#!/usr/bin/env python3
"""Validate data.json against the expected schema."""

import json
import sys
from pathlib import Path

VALID_STATUSES = {'needs_review', 'final', 'flagged', 'rejected'}
REQUIRED_FIELDS = ('id', 'pdf_url', 'title')


def fail(msg):
    print(f'ERROR: {msg}', file=sys.stderr)
    return False


def validate(path='data.json'):
    ok = True

    try:
        data = json.loads(Path(path).read_text())
    except FileNotFoundError:
        return fail(f'{path} not found')
    except json.JSONDecodeError as e:
        return fail(f'{path} is not valid JSON: {e}')

    if not isinstance(data, dict) or 'papers' not in data:
        return fail('top-level object must have a "papers" key')

    papers = data['papers']
    if not isinstance(papers, list):
        return fail('"papers" must be an array')

    seen_ids = set()

    for i, p in enumerate(papers):
        ctx = f'papers[{i}]'

        # Required string fields
        for field in REQUIRED_FIELDS:
            if field not in p:
                ok = fail(f'{ctx}: missing required field "{field}"') and ok
            elif not isinstance(p[field], str):
                ok = fail(f'{ctx}.{field}: must be a string') and ok

        # Unique IDs
        pid = p.get('id')
        if pid in seen_ids:
            ok = fail(f'{ctx}: duplicate id "{pid}"') and ok
        if pid:
            seen_ids.add(pid)

        # status
        status = p.get('status', 'needs_review')
        if status not in VALID_STATUSES:
            ok = fail(
                f'{ctx}.status: "{status}" is not valid '
                f'(must be one of {sorted(VALID_STATUSES)})'
            ) and ok

        # year: int or null
        year = p.get('year')
        if year is not None and not isinstance(year, int):
            ok = fail(f'{ctx}.year: must be an integer or null') and ok

        # peer_reviewed: bool or null
        pr = p.get('peer_reviewed')
        if pr is not None and not isinstance(pr, bool):
            ok = fail(f'{ctx}.peer_reviewed: must be a boolean or null') and ok

        # venue: str or null
        venue = p.get('venue')
        if venue is not None and not isinstance(venue, str):
            ok = fail(f'{ctx}.venue: must be a string or null') and ok

        # Array fields
        for field in ('code_repos', 'datasets', 'metrics'):
            val = p.get(field)
            if val is not None and not isinstance(val, list):
                ok = fail(f'{ctx}.{field}: must be an array') and ok

    if ok:
        print(f'✓ {path}: {len(papers)} paper(s) valid')
    return ok


if __name__ == '__main__':
    sys.exit(0 if validate() else 1)
