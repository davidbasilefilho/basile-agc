#!/usr/bin/env python3
"""Independently parse the checked-in default outputs; requires only Python 3."""
from pathlib import Path
import hashlib
import json
import xml.etree.ElementTree as ET


def check(condition, reason):
    if not condition:
        raise ValueError(reason)


def verify(root):
    output = root / "generated"
    expected = json.loads((root / "data/gcam-92-v14.json").read_text())
    profile = json.loads((root / "data/profile.json").read_text())
    report = json.loads((output / "manifest.json").read_text())
    check(report["profile"] == profile, "Profile mismatch")
    artifacts = report["outputs"]
    names = {"Basile-S23-AGC9.2-V14.agc", "Basile-AGC-Camera-photo-look.xmp"}
    check(len(artifacts) == 2 and {a["file"] for a in artifacts} == names, "Wrong manifest file set")
    for entry in artifacts:
        path = output / entry["file"]
        check(hashlib.sha256(path.read_bytes()).hexdigest() == entry["sha256"], "Wrong digest")
        check(entry["physicalDeviceVerified"] is False, "Unverified product must be labelled")
    android = ET.parse(output / "Basile-S23-AGC9.2-V14.agc").getroot()
    check(android.tag == "map", "Bad AGC root")
    actual = {}
    for node in android:
        key = node.attrib["name"]
        check(key not in actual, "Duplicate preference")
        if node.tag == "set":
            check(all(child.tag == "string" and not child.attrib for child in node), "Bad set")
            val = [child.text for child in node]
        else:
            check(len(node) == 0, "Unexpected nested preference")
            val = node.text if node.tag == "string" else node.attrib["value"]
        actual[key] = (node.tag, val)
    canonical = {k: (t, v) for t, group in expected.items() for k, v in group.items()}
    for key in canonical:
        if key.startswith("lib_profile_title_key"):
            canonical[key] = ("string", profile["name"])
    canonical["pref_qjpg_key"] = ("string", str(profile["jpegQuality"]))
    check(actual == canonical, "Settings did not roundtrip")
    xmp = ET.parse(output / "Basile-AGC-Camera-photo-look.xmp").getroot()
    ns = {"rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
          "crs": "http://ns.adobe.com/camera-raw-settings/1.0/"}
    check(xmp.tag == "{adobe:ns:meta/}xmpmeta", "Bad XMP root")
    desc = xmp.find("./rdf:RDF/rdf:Description", ns)
    check(desc is not None, "Missing RDF description")
    check(desc.findtext("./crs:Name/rdf:Alt/rdf:li", namespaces=ns) == profile["name"], "Wrong preset name")
    check(desc.attrib["{" + ns["crs"] + "}WhiteBalance"] == "As Shot", "Unexpected WB")
    print(f"Independent XML and digest validation passed: {len(actual)} typed preferences; one partial photo XMP.")


if __name__ == "__main__":
    verify(Path(__file__).resolve().parents[1])
