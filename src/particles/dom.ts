// The particle UI (settings panel, shape dock, best-hold badge) sits directly
// on <body>. The site swaps <body> on navigation, so the host moves these
// elements into each new page; see components/ParticlesContainer.tsx.
export const BODY_UI_ATTR = "data-particle-ui";

export function mountOnBody(el: HTMLElement) {
	el.setAttribute(BODY_UI_ATTR, "");
	document.body.appendChild(el);
}
