# Interactive vector animation

Use Rive only for input-driven state transitions, such as hover/pressed/selected, toggles or a reactive character. Name state machine inputs and values, define a static fallback, test keyboard and touch behavior, and keep interaction in the editor/UI. If the work is a video export, convert it to a deterministic linear playback or capture; the renderer cannot replay user input.

Interaction states are springs of the micro-UI class (damping 0.55-0.7, 0.25-0.45 s, one small overshoot) through the `spring-settle` recipe. A press, hover or toggle never drives opacity with a spring, and every rendered film state must be a deterministic function of time even when the editor state is interactive.
