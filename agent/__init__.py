"""Media Admin agent: outbound-only filesystem executor for the hosted control plane.

The cloud never touches a file; the agent never makes a decision. It executes a
handful of filesystem verbs, confined to the roots declared in its local config,
and streams "file settled" events from the folders the cloud asks it to watch.
"""

VERSION = "0.1.0"
