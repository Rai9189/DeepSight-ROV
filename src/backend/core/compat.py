"""
Pengganti fitur Python 3.9+ untuk Jetson JetPack 5 (Python 3.8 — satu-satunya
versi yang punya torch GPU di JetPack 5). Diimpor sekali di awal main.py.
Hapus file ini bila Jetson sudah JetPack 6 (Python 3.10).
"""
import asyncio
import contextvars
import functools

if not hasattr(asyncio, "to_thread"):  # Python 3.8
    async def _to_thread(func, *args, **kwargs):
        loop = asyncio.get_running_loop()
        ctx = contextvars.copy_context()
        return await loop.run_in_executor(None, functools.partial(ctx.run, func, *args, **kwargs))

    asyncio.to_thread = _to_thread
