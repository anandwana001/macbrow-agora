"""Experimental Agora voice-to-Mac demo with Jev-routed AppleScript tools."""

__all__ = ["DynamicMacAgent"]


def __getattr__(name):
    # Entrypoints must load environment settings before importing the Mac engine.
    if name == "DynamicMacAgent":
        from .agent import DynamicMacAgent

        return DynamicMacAgent
    raise AttributeError(name)
