# drone_patrol -> drone_core: heartbeat + progress, published on /<drone>/patrol/status at 5 Hz and on change.
builtin_interfaces/Time stamp
string drone
bool registered                # mode + executor registered with PX4 (ModeManagement)
string mode_name               # registered mode name, e.g. PATROL
uint8 nav_state                # PX4 nav_state assigned to the mode (EXTERNAL1..8 = 23..30); 0 if not registered
uint32 mission_id
uint32 plan_seq                # last plan received
bool plan_valid
string state                   # IDLE / TAKEOFF / PATROL / RTL / LAND / HOLD / DONE / FAILED / DEACTIVATED
bool mission_running
bool mission_finished
bool mission_failed
string failure_reason
uint16 current_item
uint16 total_items
