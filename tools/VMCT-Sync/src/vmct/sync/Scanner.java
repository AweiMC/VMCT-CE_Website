package vmct.sync;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.regex.*;

/** Scans a source checkout, parses frontmatter, and builds comparable snapshots. */
final class Scanner {
    static class Doc {
        String id;          // repository-relative id, e.g. modpacks/create
        String kind;        // modpack / map / wiki / page
        String title;
        String status;
        String loader;
        String version;
        String hash;        // content fingerprint
        Path path;
    }

    private static final Pattern FM = Pattern.compile("(?s)^---\\s*\\n(.*?)\\n---");
    private static final Pattern KV = Pattern.compile("^([A-Za-z][\\w]*):\\s*(.*)$");

    static List<Doc> scan(Path repoRoot) throws IOException {
        Path pages = repoRoot.resolve("src").resolve("pages");
        if (!Files.isDirectory(pages)) throw new IOException("找不到内容目录: " + pages);
        List<Doc> out = new ArrayList<>();
        try (var stream = Files.walk(pages)) {
            stream.filter(Files::isRegularFile)
                  .filter(p -> p.toString().endsWith(".md"))
                  .sorted()
                  .forEach(p -> {
                      Doc d = parse(p, pages);
                      if (d != null) out.add(d);
                  });
        }
        return out;
    }

    private static Doc parse(Path file, Path pages) {
        try {
            String text = Files.readString(file, StandardCharsets.UTF_8);
            String rawTitle = "", rawStatus = "", rawLoader = "", rawVersion = "";
            Matcher fm = FM.matcher(text);
            String meta = fm.find() ? fm.group(1) : "";
            String[] lines = meta.split("\\n");
            for (int i = 0; i < lines.length; i++) {
                Matcher kv = KV.matcher(lines[i]);
                if (!kv.matches()) continue;
                String key = kv.group(1), val = kv.group(2).trim().replaceAll("^['\"]|['\"]$", "");
                switch (key) {
                    case "title": rawTitle = val; break;
                    case "updateDate": /* kept in hash via full text */ break;
                    default: break;
                }
                if (key.equals("status") && val.isEmpty() && i + 1 < lines.length) {
                    Matcher t = Pattern.compile("^\\s+type:\\s*(\\S+)").matcher(lines[i + 1]);
                    if (t.find()) rawStatus = t.group(1);
                }
                if (key.equals("compatibility") && i + 1 < lines.length) {
                    for (int j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                        Matcher l = Pattern.compile("^\\s+loader:\\s*(\\S+)").matcher(lines[j]);
                        Matcher v = Pattern.compile("^\\s+minecraft:\\s*['\"]?([\\d.]+)").matcher(lines[j]);
                        if (l.find()) rawLoader = l.group(1);
                        if (v.find()) rawVersion = v.group(1);
                    }
                }
            }
            String rel = pages.relativize(file).toString().replace('\\', '/');
            String id = rel.substring(0, rel.length() - 3);
            if (id.endsWith("/index")) id = id.substring(0, id.length() - 6);
            String kind = id.startsWith("modpacks/fc5-wiki/") ? "wiki"
                        : id.startsWith("modpacks/") ? "modpack"
                        : id.startsWith("map/") ? "map" : "page";

            Doc d = new Doc();
            d.id = id; d.kind = kind;
            d.title = rawTitle.isEmpty() ? id : rawTitle;
            d.status = rawStatus; d.loader = rawLoader; d.version = rawVersion;
            d.hash = sha256(text);
            d.path = file;
            return d;
        } catch (Exception e) {
            return null;
        }
    }

    private static String sha256(String s) {
        try {
            byte[] b = MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 8; i++) sb.append(String.format("%02x", b[i]));
            return sb.toString();
        } catch (Exception e) { return "????"; }
    }

    /** Snapshot format: id \t title \t status \t loader \t version \t hash (one per line). */
    static Map<String, Doc> loadSnapshot(Path file) {
        Map<String, Doc> m = new HashMap<>();
        if (!Files.exists(file)) return m;
        try {
            for (String line : Files.readAllLines(file, StandardCharsets.UTF_8)) {
                if (line.isBlank() || line.startsWith("#")) continue;
                String[] p = line.split("\\t", -1);
                if (p.length < 6) continue;
                Doc d = new Doc();
                d.id = p[0]; d.title = p[1]; d.status = p[2]; d.loader = p[3]; d.version = p[4]; d.hash = p[5];
                m.put(d.id, d);
            }
        } catch (Exception ignore) {}
        return m;
    }

    static void saveSnapshot(Path file, List<Doc> docs) throws IOException {
        Files.createDirectories(file.getParent());
        try (var w = Files.newBufferedWriter(file, StandardCharsets.UTF_8)) {
            w.write("# VMCT sync snapshot — do not edit\n");
            for (Doc d : docs) {
                w.write(String.join("\t", d.id, d.title, d.status, d.loader, d.version, d.hash) + "\n");
            }
        }
    }

    /** Diff result. */
    static class Diff {
        final List<Doc> added = new ArrayList<>();
        final List<Doc> removed = new ArrayList<>();
        final List<Doc> changed = new ArrayList<>();
        final List<Doc> same = new ArrayList<>();
    }

    static Diff diff(Map<String, Doc> old, List<Doc> now) {
        Diff d = new Diff();
        Set<String> nowIds = new HashSet<>();
        for (Doc n : now) {
            nowIds.add(n.id);
            Doc o = old.get(n.id);
            if (o == null) d.added.add(n);
            else if (!o.hash.equals(n.hash)) d.changed.add(n);
            else d.same.add(n);
        }
        for (var e : old.entrySet()) if (!nowIds.contains(e.getKey())) d.removed.add(e.getValue());
        d.added.sort(Comparator.comparing(x -> x.id));
        d.changed.sort(Comparator.comparing(x -> x.id));
        d.removed.sort(Comparator.comparing(x -> x.id));
        return d;
    }
}
