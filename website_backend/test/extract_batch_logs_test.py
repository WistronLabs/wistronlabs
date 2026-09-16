import importlib.util
import io
import tempfile
import tarfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("extract", Path(__file__).parents[1] / "src/scripts/extract_batch_logs.py")
extract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extract)


class ArchiveTests(unittest.TestCase):
    def test_formats_and_wrapper(self):
        for extension in ("zip", "tar", "tgz", "tar.gz"):
            for wrapped in (False, True):
                with self.subTest(extension=extension, wrapped=wrapped), tempfile.TemporaryDirectory() as temp:
                    archive = Path(temp, "logs." + extension)
                    output = Path(temp, "out")
                    prefix = "wrapper/" if wrapped else ""
                    entries = {prefix + "abc1234/log.txt": b"first", prefix + "DEF5678/nested/log.log": b"second"}
                    if extension == "zip":
                        with zipfile.ZipFile(archive, "w") as z:
                            for name, data in entries.items(): z.writestr(name, data)
                    else:
                        with tarfile.open(archive, "w" if extension == "tar" else "w:gz") as t:
                            for name, data in entries.items():
                                item = tarfile.TarInfo(name); item.size = len(data)
                                t.addfile(item, io.BytesIO(data))
                    self.assertEqual(extract.unpack(archive, output, 1000, 100, 10, ["ABC1234", "DEF5678"], inspect_only=True), ["ABC1234", "DEF5678"])
                    self.assertFalse(output.exists(), "Inspection must not extract log files")
                    extract.unpack(archive, output, 1000, 100, 10, ["ABC1234", "DEF5678"])
                    self.assertEqual((output / "ABC1234/log.txt").read_bytes(), b"first")
                    self.assertEqual((output / "DEF5678/nested/log.log").read_bytes(), b"second")

    def test_single_wrapped_unit_with_arbitrary_parent_name(self):
        for parent in ("Collection of logs", "ABC1234"):
            with self.subTest(parent=parent), tempfile.TemporaryDirectory() as temp:
                archive = Path(temp, "logs.zip")
                with zipfile.ZipFile(archive, "w") as z:
                    z.writestr(parent + "/longservicetag/nested/log.txt", "ok")
                    z.writestr("__MACOSX/._metadata", "ignored")
                extract.unpack(archive, Path(temp, "out"), 100, 10, 10, ["LONGSERVICETAG", "MISSING"])
                self.assertEqual(Path(temp, "out/LONGSERVICETAG/nested/log.txt").read_text(), "ok")
                self.assertFalse(Path(temp, "out/MISSING").exists())

    def test_ambiguous_selected_folder_levels_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp, "logs.zip")
            with zipfile.ZipFile(archive, "w") as z:
                z.writestr("ABC1234/DEF5678/log.txt", "ok")
            with self.assertRaisesRegex(ValueError, "ambiguous"):
                extract.unpack(archive, Path(temp, "out"), 100, 10, 10, ["ABC1234", "DEF5678"])
            self.assertFalse(Path(temp, "out").exists())

    def test_unsafe_and_oversized_zip(self):
        cases = [({"../escape": b"bad"}, 100, 10, 10),
                 ({"ABC1234/log": b"too large"}, 2, 10, 10),
                 ({"ABC1234/a": b"a", "ABC1234/b": b"b"}, 100, 1, 10),
                 ({"ABC1234/a": b"a", "DEF5678/b": b"b"}, 100, 10, 1),
                 ({"ABC1234/A": b"a", "ABC1234/a": b"b"}, 100, 10, 10)]
        for entries, max_bytes, max_files, max_systems in cases:
            with self.subTest(entries=entries), tempfile.TemporaryDirectory() as temp:
                archive = Path(temp, "logs.zip")
                with zipfile.ZipFile(archive, "w") as z:
                    for name, data in entries.items(): z.writestr(name, data)
                with self.assertRaises(ValueError):
                    extract.unpack(archive, Path(temp, "out"), max_bytes, max_files, max_systems)
                self.assertFalse(Path(temp, "escape").exists())

    def test_tar_root_directory_entry(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp, "logs.tar.gz")
            with tarfile.open(archive, "w:gz") as t:
                root = tarfile.TarInfo("."); root.type = tarfile.DIRTYPE; t.addfile(root)
                item = tarfile.TarInfo("./ABC1234/log.txt"); item.size = 2
                t.addfile(item, io.BytesIO(b"ok"))
            extract.unpack(archive, Path(temp, "out"), 100, 10, 10)
            self.assertEqual(Path(temp, "out/ABC1234/log.txt").read_bytes(), b"ok")

    def test_tar_link_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp, "logs.tgz")
            with tarfile.open(archive, "w:gz") as t:
                item = tarfile.TarInfo("ABC1234/link"); item.type = tarfile.SYMTYPE; item.linkname = "/tmp/outside"
                t.addfile(item)
            with self.assertRaises(ValueError): extract.unpack(archive, Path(temp, "out"), 100, 10, 10)

    def test_single_unit_nested_logs_are_not_mistaken_for_wrapper(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp, "logs.zip")
            with zipfile.ZipFile(archive, "w") as z: z.writestr("LONGSERVICETAG/nested/log.txt", "ok")
            extract.unpack(archive, Path(temp, "out"), 100, 10, 10, ["LONGSERVICETAG"])
            self.assertEqual(Path(temp, "out/LONGSERVICETAG/nested/log.txt").read_text(), "ok")


if __name__ == "__main__": unittest.main()
