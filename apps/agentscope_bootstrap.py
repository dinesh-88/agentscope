import agentscope
from agentscope import observe_run, observe_span
import time

agentscope.auto_instrument()

print("AgentScope instrumentation enabled")