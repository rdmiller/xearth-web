"""Just enough GRIB2 to read NCEP's GFS fields, in numpy.

GFS's pressure-level files (pgrb2) pack each field with complex packing and second-order
spatial differencing (data representation template 5.3) on a regular lat/lon grid
(grid template 3.0). This reads those, and simple packing (5.0), with no bitmap: the
fields the wind job asks for. Anything else raises rather than decoding wrongly.
eccodes would do it all, but as a compiled library for four messages an hour.

The template numbers and octet offsets below are WMO FM 92 GRIB edition 2's.
"""

from __future__ import annotations

import datetime as dt
import struct
from dataclasses import dataclass

import numpy as np


@dataclass
class Field:
    """One decoded message: values[row, col], rows in the file's scan order (see `north_first`)."""

    discipline: int
    category: int
    parameter: int
    level_type: int
    level: float
    reference: dt.datetime
    forecast_hours: int
    lat0: float
    lon0: float
    dlat: float
    dlon: float
    values: np.ndarray


def _signed(raw: int, bits: int) -> int:
    """GRIB2's sign-and-magnitude integers (the top bit is the sign)."""
    top = 1 << (bits - 1)
    return -(raw & (top - 1)) if raw & top else raw


def _bits(buf: np.ndarray, offsets: np.ndarray, widths: np.ndarray) -> np.ndarray:
    """Unsigned big-endian integers `widths` bits long (≤ 32) starting at bit `offsets` of `buf`."""
    out = np.zeros(offsets.shape, np.int64)
    if not offsets.size:
        return out
    byte = offsets >> 3
    padded = np.concatenate([buf, np.zeros(8, np.uint8)])
    window = np.zeros(offsets.shape, np.uint64)
    for k in range(8):
        window = (window << np.uint64(8)) | padded[byte + k].astype(np.uint64)
    some = widths > 0
    shift = (offsets & 7).astype(np.uint64)
    w = widths.astype(np.uint64)
    v = (window[some] << shift[some]) >> (np.uint64(64) - w[some])
    out[some] = v.astype(np.int64)
    return out


def _packed(buf: np.ndarray, start_bit: int, count: int, width: int) -> np.ndarray:
    """`count` back-to-back `width`-bit integers."""
    if width == 0:
        return np.zeros(count, np.int64)
    offs = start_bit + np.arange(count, dtype=np.int64) * width
    return _bits(buf, offs, np.full(count, width, np.int64))


def _complex(drs: bytes, data: bytes, npts: int) -> np.ndarray:
    """Template 5.3 → the integers before scaling (X in Y = (R + X·2^E) / 10^D)."""
    nbits = drs[19]
    if drs[22] != 0:
        raise ValueError(f"missing-value management {drs[22]} not supported")
    ng = struct.unpack(">I", drs[31:35])[0]
    ref_width, width_bits = drs[35], drs[36]
    ref_len, len_inc = struct.unpack(">IB", drs[37:42])
    last_len, len_bits = struct.unpack(">IB", drs[42:47])
    order, ndesc = drs[47], drs[48]
    if order not in (0, 1, 2):
        raise ValueError(f"spatial differencing order {order} not supported")
    buf = np.frombuffer(data, np.uint8)
    pos = 0
    desc = []
    for _ in range(order + 1 if order else 0):
        desc.append(_signed(int.from_bytes(data[pos : pos + ndesc], "big"), 8 * ndesc))
        pos += ndesc
    bit = pos * 8
    refs = _packed(buf, bit, ng, nbits)
    bit += -(-ng * nbits // 8) * 8
    widths = _packed(buf, bit, ng, width_bits) + ref_width
    bit += -(-ng * width_bits // 8) * 8
    lengths = _packed(buf, bit, ng, len_bits) * len_inc + ref_len
    lengths[-1] = last_len
    bit += -(-ng * len_bits // 8) * 8
    if lengths.sum() != npts:
        raise ValueError(f"group lengths add up to {lengths.sum()}, not {npts} points")
    # Each value's group, its bit offset within the run of groups, and its width.
    group = np.repeat(np.arange(ng), lengths)
    first = np.concatenate([[0], np.cumsum(lengths)[:-1]])
    group_bit = bit + np.concatenate([[0], np.cumsum(lengths * widths)[:-1]])
    index = np.arange(npts, dtype=np.int64)
    w = widths[group]
    x = refs[group] + _bits(buf, group_bit[group] + (index - first[group]) * w, w)
    if order == 0:
        return x
    # Undo the differencing: the first `order` values are given; the rest were stored as
    # differences (less their minimum), so add the minimum back and integrate.
    d = x + desc[-1]
    if order == 1:
        # X[i] = d[i] + X[i−1]
        d[0] = desc[0]
        return np.cumsum(d)
    # X[i] = d[i] + 2·X[i−1] − X[i−2]: the steps X[i] − X[i−1] grow by d[i] each time.
    steps = d
    steps[0] = desc[0]
    steps[1] = desc[1] - desc[0]
    steps[1:] = np.cumsum(steps[1:])
    return np.cumsum(steps)


def _simple(drs: bytes, data: bytes, npts: int) -> np.ndarray:
    """Template 5.0."""
    return _packed(np.frombuffer(data, np.uint8), 0, npts, drs[19])


def decode(blob: bytes) -> list[Field]:
    """Every message in a GRIB2 file (e.g. a NOMADS filter download)."""
    fields = []
    i = 0
    while i < len(blob):
        if blob[i : i + 4] != b"GRIB":
            raise ValueError(f"no GRIB message at byte {i}")
        if blob[i + 7] != 2:
            raise ValueError(f"GRIB edition {blob[i + 7]}, not 2")
        discipline = blob[i + 6]
        total = struct.unpack(">Q", blob[i + 8 : i + 16])[0]
        end = i + total
        j = i + 16
        sec: dict[int, bytes] = {}
        while j < end - 4:
            length, number = struct.unpack(">IB", blob[j : j + 5])
            sec[number] = blob[j : j + length]
            j += length
            if number == 7:
                fields.append(_field(discipline, sec))
        i = end
    return fields


def _field(discipline: int, sec: dict[int, bytes]) -> Field:
    ids, gds, pds, drs, bms, data = sec[1], sec[3], sec[4], sec[5], sec.get(6), sec[7]
    year, month, day, hour, minute, second = struct.unpack(">HBBBBB", ids[12:19])
    reference = dt.datetime(year, month, day, hour, minute, second, tzinfo=dt.timezone.utc)
    grid = struct.unpack(">H", gds[12:14])[0]
    if grid != 0:
        raise ValueError(f"grid template 3.{grid} not supported")
    ni, nj = struct.unpack(">II", gds[30:38])
    la1 = _signed(struct.unpack(">I", gds[46:50])[0], 32) / 1e6
    lo1 = struct.unpack(">I", gds[50:54])[0] / 1e6
    di, dj = struct.unpack(">II", gds[63:71])
    scan = gds[71]
    if scan & 0b1110_0000 not in (0, 0b0100_0000) or scan & 0b0001_0000:
        raise ValueError(f"scanning mode {scan:08b} not supported")
    north_first = not scan & 0b0100_0000
    tpl = struct.unpack(">H", pds[7:9])[0]
    if tpl != 0:
        raise ValueError(f"product template 4.{tpl} not supported")
    unit, fcst = pds[17], struct.unpack(">I", pds[18:22])[0]
    if unit != 1:
        raise ValueError(f"forecast time unit {unit}, not hours")
    level = struct.unpack(">I", pds[24:28])[0] / 10 ** _signed(pds[23], 8)
    if bms is not None and bms[5] != 255:
        raise ValueError("bitmapped fields not supported")
    npts, rep = struct.unpack(">IH", drs[5:11])
    if npts != ni * nj:
        raise ValueError(f"{npts} points for a {ni}x{nj} grid")
    if rep == 0:
        x = _simple(drs, data[5:], npts)
    elif rep == 3:
        x = _complex(drs, data[5:], npts)
    else:
        raise ValueError(f"data representation template 5.{rep} not supported")
    r = struct.unpack(">f", drs[11:15])[0]
    e = _signed(struct.unpack(">H", drs[15:17])[0], 16)
    d = _signed(struct.unpack(">H", drs[17:19])[0], 16)
    values = ((r + x * 2.0**e) / 10.0**d).astype(np.float32).reshape(nj, ni)
    return Field(
        discipline=discipline,
        category=pds[9],
        parameter=pds[10],
        level_type=pds[22],
        level=level,
        reference=reference,
        forecast_hours=fcst,
        lat0=la1,
        lon0=lo1,
        dlat=(-dj if north_first else dj) / 1e6,
        dlon=di / 1e6,
        values=values,
    )
