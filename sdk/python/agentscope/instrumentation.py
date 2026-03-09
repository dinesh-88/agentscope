from __future__ import annotations

import builtins
import inspect
import sys
import time
import uuid
from dataclasses import dataclass
from functools import wraps
from typing import Any, Callable

from .run import _current_run_state, observe_run
from .span import observe_span


@dataclass(frozen=True)
class TargetSpec:
    key: str
    provider: str
    module: str
    path: tuple[str, ...]
    request_extractor: Callable[[Callable[..., Any], tuple[Any, ...], dict[str, Any]], dict[str, Any]]
    response_extractor: Callable[[Any], dict[str, Any]]


@dataclass(frozen=True)
class ProviderAdapter:
    name: str
    targets: tuple[TargetSpec, ...]


_ORIGINALS: dict[str, Callable[..., Any]] = {}
_PATCHED_TARGETS: set[str] = set()
_ACTIVE_TARGETS: list[TargetSpec] = []
_IMPORT_HOOK_INSTALLED = False
_ORIGINAL_IMPORT = builtins.__import__


def _safe_getattr(value: Any, name: str, default: Any = None) -> Any:
    try:
        return getattr(value, name, default)
    except Exception:
        return default


def _safe_get(value: Any, key: str, default: Any = None) -> Any:
    if isinstance(value, dict):
        return value.get(key, default)
    return _safe_getattr(value, key, default)


def _extract_call_data(
    original: Callable[..., Any], args: tuple[Any, ...], kwargs: dict[str, Any]
) -> dict[str, Any]:
    try:
        bound = inspect.signature(original).bind_partial(*args, **kwargs)
        data = dict(bound.arguments)
        extra_kwargs = data.pop("kwargs", None)
        if isinstance(extra_kwargs, dict):
            data.update(extra_kwargs)
        return data
    except Exception:
        return dict(kwargs)


def _pick_first(data: dict[str, Any], keys: tuple[str, ...], default: Any = None) -> Any:
    for key in keys:
        if key in data and data[key] is not None:
            return data[key]
    return default


def _extract_text_from_openai_like_response(response: Any) -> str | None:
    if isinstance(response, dict):
        choices = response.get("choices")
        if choices:
            message = choices[0].get("message", {})
            content = message.get("content")
            if isinstance(content, str):
                return content
        output_text = response.get("output_text")
        if isinstance(output_text, str):
            return output_text
        return response.get("response")

    choices = _safe_getattr(response, "choices")
    if choices:
        message = _safe_getattr(choices[0], "message")
        content = _safe_getattr(message, "content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = [_safe_getattr(item, "text") for item in content]
            parts = [part for part in parts if isinstance(part, str)]
            if parts:
                return "".join(parts)

    output_text = _safe_getattr(response, "output_text")
    if isinstance(output_text, str):
        return output_text
    return _safe_getattr(response, "response")


def _extract_text_from_anthropic_response(response: Any) -> str | None:
    if isinstance(response, dict):
        content = response.get("content")
        if isinstance(content, list):
            parts = [item.get("text") for item in content if isinstance(item, dict)]
            parts = [part for part in parts if isinstance(part, str)]
            return "".join(parts) if parts else None
        return None

    content = _safe_getattr(response, "content")
    if isinstance(content, list):
        parts = [_safe_getattr(item, "text") for item in content]
        parts = [part for part in parts if isinstance(part, str)]
        return "".join(parts) if parts else None
    return None


def _extract_text_from_langchain_response(response: Any) -> str | None:
    if isinstance(response, str):
        return response
    if isinstance(response, dict):
        content = response.get("content")
        if isinstance(content, str):
            return content
        return response.get("text")
    content = _safe_getattr(response, "content")
    if isinstance(content, str):
        return content
    text = _safe_getattr(response, "text")
    if isinstance(text, str):
        return text
    return None


def _extract_text_from_ollama_response(response: Any) -> str | None:
    if isinstance(response, dict):
        message = response.get("message")
        if isinstance(message, dict):
            content = message.get("content")
            if isinstance(content, str):
                return content
        text = response.get("response")
        if isinstance(text, str):
            return text
        return None

    message = _safe_getattr(response, "message")
    content = _safe_getattr(message, "content")
    if isinstance(content, str):
        return content
    text = _safe_getattr(response, "response")
    if isinstance(text, str):
        return text
    return None


def _openai_request_extractor(
    original: Callable[..., Any], args: tuple[Any, ...], kwargs: dict[str, Any]
) -> dict[str, Any]:
    data = _extract_call_data(original, args, kwargs)
    return {
        "model": _pick_first(data, ("model",)),
        "messages": _pick_first(data, ("messages", "input", "prompt")),
        "prompt": _pick_first(data, ("prompt", "input")),
    }


def _openai_response_extractor(response: Any) -> dict[str, Any]:
    usage = _safe_get(response, "usage")
    return {
        "response_text": _extract_text_from_openai_like_response(response),
        "input_tokens": _pick_first(
            {
                "prompt_tokens": _safe_get(usage, "prompt_tokens"),
                "input_tokens": _safe_get(usage, "input_tokens"),
            },
            ("prompt_tokens", "input_tokens"),
        ),
        "output_tokens": _pick_first(
            {
                "completion_tokens": _safe_get(usage, "completion_tokens"),
                "output_tokens": _safe_get(usage, "output_tokens"),
            },
            ("completion_tokens", "output_tokens"),
        ),
    }


def _anthropic_request_extractor(
    original: Callable[..., Any], args: tuple[Any, ...], kwargs: dict[str, Any]
) -> dict[str, Any]:
    data = _extract_call_data(original, args, kwargs)
    return {
        "model": _pick_first(data, ("model",)),
        "messages": _pick_first(data, ("messages",)),
        "prompt": _pick_first(data, ("system",)),
    }


def _anthropic_response_extractor(response: Any) -> dict[str, Any]:
    usage = _safe_get(response, "usage")
    return {
        "response_text": _extract_text_from_anthropic_response(response),
        "input_tokens": _safe_get(usage, "input_tokens"),
        "output_tokens": _safe_get(usage, "output_tokens"),
    }


def _langchain_request_extractor(
    original: Callable[..., Any], args: tuple[Any, ...], kwargs: dict[str, Any]
) -> dict[str, Any]:
    data = _extract_call_data(original, args, kwargs)
    llm_obj = _pick_first(data, ("self",))
    model = _safe_getattr(llm_obj, "model_name") or _safe_getattr(llm_obj, "model")
    input_data = _pick_first(data, ("input", "messages", "prompt"))
    return {
        "model": model,
        "messages": input_data if isinstance(input_data, list) else None,
        "prompt": input_data if isinstance(input_data, (str, dict)) else None,
    }


def _langchain_response_extractor(response: Any) -> dict[str, Any]:
    return {
        "response_text": _extract_text_from_langchain_response(response),
        "input_tokens": None,
        "output_tokens": None,
    }


def _litellm_request_extractor(
    original: Callable[..., Any], args: tuple[Any, ...], kwargs: dict[str, Any]
) -> dict[str, Any]:
    data = _extract_call_data(original, args, kwargs)
    return {
        "model": _pick_first(data, ("model",)),
        "messages": _pick_first(data, ("messages",)),
        "prompt": _pick_first(data, ("prompt", "input")),
    }


def _litellm_response_extractor(response: Any) -> dict[str, Any]:
    usage = _safe_get(response, "usage")
    return {
        "response_text": _extract_text_from_openai_like_response(response),
        "input_tokens": _safe_get(usage, "prompt_tokens"),
        "output_tokens": _safe_get(usage, "completion_tokens"),
    }


def _ollama_request_extractor(
    original: Callable[..., Any], args: tuple[Any, ...], kwargs: dict[str, Any]
) -> dict[str, Any]:
    data = _extract_call_data(original, args, kwargs)
    return {
        "model": _pick_first(data, ("model",)),
        "messages": _pick_first(data, ("messages",)),
        "prompt": _pick_first(data, ("prompt",)),
    }


def _ollama_response_extractor(response: Any) -> dict[str, Any]:
    return {
        "response_text": _extract_text_from_ollama_response(response),
        "input_tokens": _safe_get(response, "prompt_eval_count"),
        "output_tokens": _safe_get(response, "eval_count"),
    }


def _build_provider_registry() -> tuple[ProviderAdapter, ...]:
    return (
        ProviderAdapter(
            name="openai",
            targets=(
                TargetSpec(
                    key="openai.chat.completions.create",
                    provider="openai",
                    module="openai.resources.chat.completions.completions",
                    path=("Completions", "create"),
                    request_extractor=_openai_request_extractor,
                    response_extractor=_openai_response_extractor,
                ),
                TargetSpec(
                    key="openai.chat.completions.async_create",
                    provider="openai",
                    module="openai.resources.chat.completions.completions",
                    path=("AsyncCompletions", "create"),
                    request_extractor=_openai_request_extractor,
                    response_extractor=_openai_response_extractor,
                ),
            ),
        ),
        ProviderAdapter(
            name="anthropic",
            targets=(
                TargetSpec(
                    key="anthropic.messages.create",
                    provider="anthropic",
                    module="anthropic.resources.messages.messages",
                    path=("Messages", "create"),
                    request_extractor=_anthropic_request_extractor,
                    response_extractor=_anthropic_response_extractor,
                ),
                TargetSpec(
                    key="anthropic.messages.async_create",
                    provider="anthropic",
                    module="anthropic.resources.messages.messages",
                    path=("AsyncMessages", "create"),
                    request_extractor=_anthropic_request_extractor,
                    response_extractor=_anthropic_response_extractor,
                ),
            ),
        ),
        ProviderAdapter(
            name="langchain",
            targets=(
                TargetSpec(
                    key="langchain.chat.invoke",
                    provider="langchain",
                    module="langchain_core.language_models.chat_models",
                    path=("BaseChatModel", "invoke"),
                    request_extractor=_langchain_request_extractor,
                    response_extractor=_langchain_response_extractor,
                ),
                TargetSpec(
                    key="langchain.chat.ainvoke",
                    provider="langchain",
                    module="langchain_core.language_models.chat_models",
                    path=("BaseChatModel", "ainvoke"),
                    request_extractor=_langchain_request_extractor,
                    response_extractor=_langchain_response_extractor,
                ),
                TargetSpec(
                    key="langchain.llm.invoke",
                    provider="langchain",
                    module="langchain_core.language_models.llms",
                    path=("BaseLLM", "invoke"),
                    request_extractor=_langchain_request_extractor,
                    response_extractor=_langchain_response_extractor,
                ),
                TargetSpec(
                    key="langchain.llm.ainvoke",
                    provider="langchain",
                    module="langchain_core.language_models.llms",
                    path=("BaseLLM", "ainvoke"),
                    request_extractor=_langchain_request_extractor,
                    response_extractor=_langchain_response_extractor,
                ),
            ),
        ),
        ProviderAdapter(
            name="litellm",
            targets=(
                TargetSpec(
                    key="litellm.completion",
                    provider="litellm",
                    module="litellm",
                    path=("completion",),
                    request_extractor=_litellm_request_extractor,
                    response_extractor=_litellm_response_extractor,
                ),
                TargetSpec(
                    key="litellm.acompletion",
                    provider="litellm",
                    module="litellm",
                    path=("acompletion",),
                    request_extractor=_litellm_request_extractor,
                    response_extractor=_litellm_response_extractor,
                ),
            ),
        ),
        ProviderAdapter(
            name="ollama",
            targets=(
                TargetSpec(
                    key="ollama.chat",
                    provider="ollama",
                    module="ollama",
                    path=("chat",),
                    request_extractor=_ollama_request_extractor,
                    response_extractor=_ollama_response_extractor,
                ),
                TargetSpec(
                    key="ollama.generate",
                    provider="ollama",
                    module="ollama",
                    path=("generate",),
                    request_extractor=_ollama_request_extractor,
                    response_extractor=_ollama_response_extractor,
                ),
            ),
        ),
    )


PROVIDER_REGISTRY = _build_provider_registry()


def _append_artifacts(
    *,
    span: dict[str, Any],
    provider: str,
    model: Any,
    messages: Any,
    prompt: Any,
    response_text: Any,
    input_tokens: Any,
    output_tokens: Any,
    latency_ms: int,
) -> None:
    run_state = _current_run_state()
    if run_state is None:
        return

    run_state.artifacts.append(
        {
            "id": str(uuid.uuid4()),
            "run_id": span["run_id"],
            "span_id": span["id"],
            "kind": "llm_prompt",
            "payload": {
                "provider": provider,
                "model": model,
                "messages": messages,
                "prompt": prompt,
            },
        }
    )
    run_state.artifacts.append(
        {
            "id": str(uuid.uuid4()),
            "run_id": span["run_id"],
            "span_id": span["id"],
            "kind": "llm_response",
            "payload": {
                "provider": provider,
                "model": model,
                "response_text": response_text,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "latency_ms": latency_ms,
            },
        }
    )


def _run_instrumented_sync(
    *,
    target: TargetSpec,
    original: Callable[..., Any],
    args: tuple[Any, ...],
    kwargs: dict[str, Any],
) -> Any:
    req = target.request_extractor(original, args, kwargs)
    started = time.time()
    with observe_span("llm_call", span_type="llm_call") as span:
        response = original(*args, **kwargs)
        res = target.response_extractor(response)
        latency_ms = int((time.time() - started) * 1000)
        span["provider"] = target.provider
        span["model"] = req.get("model")
        span["input_tokens"] = res.get("input_tokens")
        span["output_tokens"] = res.get("output_tokens")
        span["latency_ms"] = latency_ms
        _append_artifacts(
            span=span,
            provider=target.provider,
            model=req.get("model"),
            messages=req.get("messages"),
            prompt=req.get("prompt"),
            response_text=res.get("response_text"),
            input_tokens=res.get("input_tokens"),
            output_tokens=res.get("output_tokens"),
            latency_ms=latency_ms,
        )
        return response


async def _run_instrumented_async(
    *,
    target: TargetSpec,
    original: Callable[..., Any],
    args: tuple[Any, ...],
    kwargs: dict[str, Any],
) -> Any:
    req = target.request_extractor(original, args, kwargs)
    started = time.time()
    with observe_span("llm_call", span_type="llm_call") as span:
        response = await original(*args, **kwargs)
        res = target.response_extractor(response)
        latency_ms = int((time.time() - started) * 1000)
        span["provider"] = target.provider
        span["model"] = req.get("model")
        span["input_tokens"] = res.get("input_tokens")
        span["output_tokens"] = res.get("output_tokens")
        span["latency_ms"] = latency_ms
        _append_artifacts(
            span=span,
            provider=target.provider,
            model=req.get("model"),
            messages=req.get("messages"),
            prompt=req.get("prompt"),
            response_text=res.get("response_text"),
            input_tokens=res.get("input_tokens"),
            output_tokens=res.get("output_tokens"),
            latency_ms=latency_ms,
        )
        return response


def _build_wrapper(original: Callable[..., Any], target: TargetSpec) -> Callable[..., Any]:
    if inspect.iscoroutinefunction(original):

        @wraps(original)
        async def _async_wrapper(*args: Any, **kwargs: Any) -> Any:
            if _current_run_state() is None:
                with observe_run(f"{target.provider}_auto_instrumentation", agent_name=target.provider):
                    return await _run_instrumented_async(
                        target=target, original=original, args=args, kwargs=kwargs
                    )
            return await _run_instrumented_async(target=target, original=original, args=args, kwargs=kwargs)

        _async_wrapper.__agentscope_wrapped__ = True  # type: ignore[attr-defined]
        return _async_wrapper

    @wraps(original)
    def _sync_wrapper(*args: Any, **kwargs: Any) -> Any:
        if _current_run_state() is None:
            with observe_run(f"{target.provider}_auto_instrumentation", agent_name=target.provider):
                return _run_instrumented_sync(target=target, original=original, args=args, kwargs=kwargs)
        return _run_instrumented_sync(target=target, original=original, args=args, kwargs=kwargs)

    _sync_wrapper.__agentscope_wrapped__ = True  # type: ignore[attr-defined]
    return _sync_wrapper


def _resolve_parent(module: Any, path: tuple[str, ...]) -> tuple[Any, str] | None:
    if not path:
        return None
    parent = module
    for part in path[:-1]:
        parent = getattr(parent, part, None)
        if parent is None:
            return None
    return parent, path[-1]


def _patch_target(target: TargetSpec) -> None:
    if target.key in _PATCHED_TARGETS:
        return

    module = sys.modules.get(target.module)
    if module is None:
        return

    resolved = _resolve_parent(module, target.path)
    if resolved is None:
        return
    parent, attr_name = resolved
    current = getattr(parent, attr_name, None)
    if current is None:
        return
    if getattr(current, "__agentscope_wrapped__", False):
        _PATCHED_TARGETS.add(target.key)
        return

    if target.key not in _ORIGINALS:
        _ORIGINALS[target.key] = current
    wrapped = _build_wrapper(_ORIGINALS[target.key], target)
    setattr(parent, attr_name, wrapped)
    _PATCHED_TARGETS.add(target.key)


def _try_patch_available_targets() -> None:
    for target in _ACTIVE_TARGETS:
        _patch_target(target)


def _install_import_hook() -> None:
    global _IMPORT_HOOK_INSTALLED
    if _IMPORT_HOOK_INSTALLED:
        return

    def _instrumenting_import(
        name: str,
        globals_dict: dict[str, Any] | None = None,
        locals_dict: dict[str, Any] | None = None,
        fromlist: tuple[Any, ...] = (),
        level: int = 0,
    ) -> Any:
        module = _ORIGINAL_IMPORT(name, globals_dict, locals_dict, fromlist, level)
        _try_patch_available_targets()
        return module

    builtins.__import__ = _instrumenting_import
    _IMPORT_HOOK_INSTALLED = True


def _resolve_enabled_targets(providers: list[str] | None) -> list[TargetSpec]:
    if providers is None:
        enabled = {adapter.name for adapter in PROVIDER_REGISTRY}
    else:
        enabled = {name.lower() for name in providers}

    targets: list[TargetSpec] = []
    for adapter in PROVIDER_REGISTRY:
        if adapter.name in enabled:
            targets.extend(adapter.targets)
    return targets


def auto_instrument(providers: list[str] | None = None) -> None:
    global _ACTIVE_TARGETS
    _ACTIVE_TARGETS = _resolve_enabled_targets(providers)
    _install_import_hook()
    _try_patch_available_targets()
