# Button Alignment v180

## Scope

- Normalized vertical alignment for shared non-TV button groups.
- Reasserted `inline-flex`, `align-items: center`, `justify-content: center`, and stable line-height for buttons, upload labels, tab buttons, and dock buttons.
- Normalized direct text wrappers such as `span`, `small`, `b`, `strong`, and `em` inside buttons so two-line labels no longer sit high or low.
- Kept TV LIVE untouched.

## Covered Groups

- Operator toolbar, round action buttons, point buttons, group-size buttons, and mobile dock.
- Player DB toolbar and bulk buttons.
- Dashboard toolbar and period buttons.
- Admin toolbar and list action buttons.
- Login/auth, LIVE lobby, session lease, status, and general button rows.

## QA Focus

- Mobile operator: top nav, round tabs, round action row, bottom dock.
- Player DB and admin mobile: toolbar/list action rows.
- Dashboard PC/mobile: toolbar and period row.
- Confirm build `v180` and no console errors on representative routes.
