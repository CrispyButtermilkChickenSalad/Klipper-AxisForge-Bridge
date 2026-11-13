# Testing

```bash
pip install -r requirements.txt pytest
python -m pytest tests --ignore-glob="tests/browser_*"
```

- Run on **Linux**: several tests rely on POSIX features (`fcntl`, `os.fchmod`,
  `os.killpg`) and fail on Windows.
- `tests/browser_*.py` drive the UI and need a browser.
- Unit tests do not replace commissioning with the real arm and Klipper host;
  qualify clock timing under sustained load and verify a controlled print.
