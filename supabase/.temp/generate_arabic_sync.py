from pathlib import Path
import re


SEED_PATH = Path("supabase/seeds/seed.sql")
OUTPUT_PATH = Path("supabase/.temp/ar_sync.sql")


def transform_seed(sql: str) -> str:
    pattern = re.compile(
        r"(INSERT INTO\s+([^(]+)\s*\(([^)]+)\)\s*VALUES\n)(.*?);",
        re.S,
    )

    def repl(match: re.Match[str]) -> str:
      statement = match.group(0)
      if "ON CONFLICT" in statement:
        return statement

      columns = [col.strip() for col in match.group(3).split(",")]
      if "id" not in columns:
        return statement

      update_columns = [col for col in columns if col != "id"]
      updates = ",\n  ".join(f"{col} = EXCLUDED.{col}" for col in update_columns)
      return f"{match.group(1)}{match.group(4)}\nON CONFLICT (id) DO UPDATE SET\n  {updates};\n"

    return pattern.sub(repl, sql)


def main() -> None:
    sql = SEED_PATH.read_text(encoding="utf-8")
    OUTPUT_PATH.write_text(transform_seed(sql), encoding="utf-8")


if __name__ == "__main__":
    main()
