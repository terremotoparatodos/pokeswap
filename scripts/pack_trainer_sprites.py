"""Pack four-direction trainer GIFs into the sheet used by WildLands.

Rows are south, north, west and east. Each input GIF contributes its first
four frames. Walk-only trainers produce a 4x4 sheet; passing a run set appends
four run columns, producing the 8x4 sheet used by the player character.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageSequence


DIRECTIONS = ("S", "N", "W", "E")


def direction_file(folder: Path, direction: str, action: str) -> Path:
    matches = sorted(folder.glob(f"*_{action}{direction}_*.gif"))
    if len(matches) != 1:
        raise ValueError(f"expected one {action}{direction} GIF in {folder}, found {len(matches)}")
    return matches[0]


def frames(path: Path) -> list[Image.Image]:
    with Image.open(path) as image:
        output = [frame.convert("RGBA") for frame in ImageSequence.Iterator(image)]
    if len(output) < 4:
        raise ValueError(f"{path} has {len(output)} frames; expected at least 4")
    return output[:4]


def pack(folder: Path, output: Path, include_run: bool) -> None:
    actions = ("Walk", "Run") if include_run else ("Walk",)
    rows = [[frames(direction_file(folder, direction, action)) for action in actions] for direction in DIRECTIONS]
    cell = rows[0][0][0].size
    if cell[0] != cell[1]:
        raise ValueError(f"trainer cells must be square, got {cell}")
    for row in rows:
        for action in row:
            if any(frame.size != cell for frame in action):
                raise ValueError("all trainer frames must share the same dimensions")

    sheet = Image.new("RGBA", (cell[0] * 4 * len(actions), cell[1] * 4))
    for row_index, row in enumerate(rows):
        for action_index, action in enumerate(row):
            for frame_index, frame in enumerate(action):
                column = action_index * 4 + frame_index
                sheet.paste(frame, (column * cell[0], row_index * cell[1]))
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--include-run", action="store_true")
    args = parser.parse_args()
    pack(args.folder, args.output, args.include_run)


if __name__ == "__main__":
    main()
