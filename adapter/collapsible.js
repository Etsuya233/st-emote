/**
 * The panel's collapsible sections, built in the client's own `inline-drawer`
 * shape rather than a widget of our own.
 *
 * The panel's top-level drawer is already a client drawer, and the client's
 * stylesheet and its click handler are what make one work: `.inline-drawer-
 * content` is `display: none` until a click on `.inline-drawer-toggle` slides
 * it, and the same handler swaps `fa-circle-chevron-down`/`down` for
 * `fa-circle-chevron-up`/`up` on `.inline-drawer-icon`. Hand-rolling `<details>`
 * or a `max-height` animation would re-implement the animation, the styling and
 * the keyboard behaviour of something already in the page — and would look
 * foreign next to every other drawer in the client.
 *
 * **What this module owns, and what it does not.** The initial state, the
 * markup, and the `aria-expanded` the client never writes are ours. The click
 * is the client's: our listener deliberately does *not* touch the content's
 * `display`, because jQuery's `slideToggle` decides which way to slide by
 * asking whether the element is hidden *at the moment it runs*, and our target-
 * phase listener runs first — flipping the display here would make it slide the
 * other way. So the two agree on the state and only the client moves it.
 *
 * State is not persisted, and deliberately so: persistence would mean deciding
 * where it lives and how it merges with the ticket-08 settings, which is a
 * ticket of its own. The settings half of the panel is not rebuilt on a change
 * (only the pack list is), so a section the user opened stays open while they
 * edit.
 */

/** The chevron the client swaps between, and the state class that goes with it. */
const CHEVRON = {
    down: { glyph: 'fa-circle-chevron-down', state: 'down' },
    up: { glyph: 'fa-circle-chevron-up', state: 'up' },
};

/**
 * One collapsible section: the client's drawer, our title, and a content
 * element the caller fills.
 *
 * The returned `setExpanded` moves the content too and is for the *initial*
 * state. The click handler uses the state-only half, for the reason in the
 * module note.
 *
 * @param {object} options
 * @param {string} options.title - The localized sentence on the header. A
 *   collapsible with no title is not a collapsible, it is a closed box.
 * @param {boolean} [options.open] - Whether it starts expanded. The content is
 *   given an inline `display`, exactly as the client's own `toggleDrawer` does,
 *   so the initial state is in the DOM rather than in a stylesheet this
 *   extension does not control.
 * @param {string} [options.className] - The caller's own hook, e.g.
 *   `st-emote-size-set`.
 * @returns {{section: HTMLDivElement, toggle: HTMLDivElement, content: HTMLDivElement,
 *   icon: HTMLDivElement, setExpanded: (expanded: boolean) => void}}
 */
export function collapsibleSection({ title, open = false, className = '' }) {
    const section = document.createElement('div');
    section.className = `inline-drawer st-emote-section ${className}`.trim();

    const toggle = document.createElement('div');
    toggle.className = 'inline-drawer-toggle inline-drawer-header';

    const label = document.createElement('span');
    label.className = 'st-emote-section-title';
    label.textContent = title;

    const icon = document.createElement('div');
    icon.className = 'inline-drawer-icon fa-solid';

    const content = document.createElement('div');
    content.className = 'inline-drawer-content';

    toggle.append(label, icon);
    section.append(toggle, content);

    const showState = (expanded) => {
        const [was, now] = expanded ? ['down', 'up'] : ['up', 'down'];
        // The client toggles these two pairs itself, so they have to be in the
        // same shape it expects or its own click would not find them.
        icon.classList.remove(CHEVRON[was].glyph, CHEVRON[was].state);
        icon.classList.add(CHEVRON[now].glyph, CHEVRON[now].state);
        toggle.setAttribute('aria-expanded', String(expanded));
    };

    const setExpanded = (expanded) => {
        showState(expanded);
        content.style.display = expanded ? 'block' : 'none';
    };
    setExpanded(open);

    // The client animates the content and keeps the chevron in step, but it
    // writes no `aria-expanded` — so a header that advertised one would
    // advertise the state it started in forever. This runs in the target phase,
    // before the client's document-level delegated handler, and the client
    // always flips, so the two cannot disagree.
    toggle.addEventListener('click', () => {
        showState(toggle.getAttribute('aria-expanded') !== 'true');
    });

    return { section, toggle, content, icon, setExpanded };
}

/**
 * Put an existing block of markup behind a header, in place.
 *
 * The panel's fixed skeleton stays the home of its own markup and ids; this
 * wraps it rather than rebuilding it, so a sentence an id already carries is
 * still filled in the same place by the same line of code.
 *
 * @param {Element} block - The wrapper whose children become the content. It is
 *   replaced by the section.
 * @param {string} title
 * @param {{className?: string}} [options]
 * @returns {Element} The section that replaced the block.
 */
export function collapseBlock(block, title, options = {}) {
    const { section, content } = collapsibleSection({ title, className: options.className });
    content.append(...block.childNodes);
    block.replaceWith(section);
    return section;
}
