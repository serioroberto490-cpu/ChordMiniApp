import json
import sys
from pathlib import Path

from analysis import analyze
from chordmini_mix import analyze_mix


if __name__ == "__main__":
    file = Path(sys.argv[2]).resolve()
    result = analyze_mix(file) if sys.argv[1] == "mix" else analyze(file)
    print(json.dumps(result, allow_nan=False))
