# Loadable Widgets Design

Widgets are first-party React components loaded through typed dynamic imports in
the widget registry. The host passes instance identity, mode, theme, and host
capabilities as props. The iframe bridge and HTML widget entries have been
removed.
