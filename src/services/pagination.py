"""Shared pagination helpers for alphabetical list views."""

import re
from itertools import groupby

_ARTICLE_RE = re.compile(r'^(the|a|an)\s+', re.IGNORECASE)


def compute_sort_name(name: str) -> str:
    """Strip leading articles and return lowercase sort name.

    "The Goldbergs" -> "goldbergs", "A Team" -> "team", "An Example" -> "example"
    """
    return _ARTICLE_RE.sub('', name).lower() if name else ''


def sort_key_char(sort_name: str) -> str:
    """First character uppercased, or '#' for non-alpha."""
    if not sort_name:
        return '#'
    ch = sort_name[0].upper()
    return ch if ch.isalpha() else '#'


def sort_key_prefix(sort_name: str, length: int = 2) -> str:
    """First `length` chars, title-cased for display labels."""
    prefix = sort_name[:length] if sort_name else '#'
    return prefix.title()


def compute_page_boundaries(sorted_items, target_size: int):
    """Break sorted items into pages at letter boundaries.

    Each item in sorted_items is (id, name, sort_name).
    Returns list of {"start": idx, "end": idx, "label": str}.
    """
    if not sorted_items or target_size <= 0:
        return [{"start": 0, "end": len(sorted_items) - 1, "label": "All"}] if sorted_items else []

    def first_letter(item):
        return sort_key_char(item[2])

    groups = []
    for letter, items in groupby(sorted_items, key=first_letter):
        groups.append((letter, list(items)))

    pages = []
    current_page_items = []
    current_page_start = 0

    def flush_page(items, start_idx):
        if not items:
            return
        pages.append({
            "start": start_idx,
            "end": start_idx + len(items) - 1,
            "items": items,
        })

    for letter, group_items in groups:
        group_size = len(group_items)

        if len(current_page_items) == 0:
            if group_size > target_size:
                sub_groups = []
                for prefix, sub_items in groupby(group_items, key=lambda x: sort_key_prefix(x[2])):
                    sub_groups.append((prefix, list(sub_items)))
                for prefix, sub_items in sub_groups:
                    if len(current_page_items) + len(sub_items) <= target_size or len(current_page_items) == 0:
                        current_page_items.extend(sub_items)
                    else:
                        flush_page(current_page_items, current_page_start)
                        current_page_start = pages[-1]["end"] + 1 if pages else 0
                        current_page_items = list(sub_items)
            else:
                current_page_items.extend(group_items)
        elif len(current_page_items) + group_size <= target_size:
            current_page_items.extend(group_items)
        else:
            flush_page(current_page_items, current_page_start)
            current_page_start = pages[-1]["end"] + 1
            current_page_items = []

            if group_size > target_size:
                sub_groups = []
                for prefix, sub_items in groupby(group_items, key=lambda x: sort_key_prefix(x[2])):
                    sub_groups.append((prefix, list(sub_items)))
                for prefix, sub_items in sub_groups:
                    if len(current_page_items) + len(sub_items) <= target_size or len(current_page_items) == 0:
                        current_page_items.extend(sub_items)
                    else:
                        flush_page(current_page_items, current_page_start)
                        current_page_start = pages[-1]["end"] + 1
                        current_page_items = list(sub_items)
            else:
                current_page_items.extend(group_items)

    if current_page_items:
        flush_page(current_page_items, current_page_start)

    # Compute labels
    letter_page_count = {}
    for page in pages:
        page_letters = set()
        for item in page["items"]:
            page_letters.add(sort_key_char(item[2]))
        for lt in page_letters:
            letter_page_count[lt] = letter_page_count.get(lt, 0) + 1

    result = []
    for page in pages:
        items = page["items"]
        first_char = sort_key_char(items[0][2])
        last_char = sort_key_char(items[-1][2])

        if first_char == last_char and letter_page_count.get(first_char, 1) > 1:
            first_prefix = sort_key_prefix(items[0][2])
            last_prefix = sort_key_prefix(items[-1][2])
            label = first_prefix if first_prefix == last_prefix else f"{first_prefix}-{last_prefix}"
        elif first_char == last_char:
            label = first_char
        else:
            label = f"{first_char}-{last_char}"

        result.append({
            "start": page["start"],
            "end": page["end"],
            "label": label,
        })

    return result
