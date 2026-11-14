"""Готовые тесты по «Полке» и тексты стихов для проверки → supabase/seed_reading.sql (в git не попадает: там ответы).

python3 tools/library/build_seed.py
"""
import json, os, random, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from quizzes import Q  # noqa: E402


def lit(s):
    return "'" + str(s).replace("'", "''") + "'"


def main():
    out = ["-- Сгенерировано tools/library/build_seed.py", "begin;"]
    for pos, qz in enumerate(Q):
        rnd = random.Random("leksikon-" + qz["work"])
        questions, keys = [], []
        for text, options, block in qz["questions"]:
            order = list(range(len(options)))
            rnd.shuffle(order)
            questions.append({"q": text, "o": [options[i] for i in order], "b": block})
            keys.append(order.index(0))
        slug = f"polka-{qz['work']}"
        url = f"https://polka.academy/articles/{qz['polka']}"
        out.append(
            "insert into public.reading_quizzes (slug, work_id, title, kind, url, questions, points, position) values ("
            f"{lit(slug)}, {lit(qz['work'])}, {lit(qz['title'])}, 'polka', {lit(url)}, {lit(json.dumps(questions, ensure_ascii=False))}::jsonb, {qz['points']}, {pos})"
            " on conflict (slug) do update set work_id = excluded.work_id, title = excluded.title, url = excluded.url,"
            " questions = excluded.questions, points = excluded.points, position = excluded.position;")
        out.append(
            "insert into public.reading_keys (quiz_id, answers) select id, " + lit("{" + ",".join(map(str, keys)) + "}") +
            "::integer[] from public.reading_quizzes where slug = " + lit(slug) +
            " on conflict (quiz_id) do update set answers = excluded.answers;")
    poems = json.load(open(os.path.join(SITE, "js", "library-data", "poems.json")))["poems"]
    for p in poems:
        if not p.get("text"):
            continue
        out.append("insert into public.poem_texts (id, author, title, body) values ("
                   f"{lit(p['id'])}, {lit(p['author'])}, {lit(p['title'])}, {lit(p['text'])})"
                   " on conflict (id) do update set author = excluded.author, title = excluded.title, body = excluded.body;")
    out.append("commit;")
    path = os.path.join(SITE, "supabase", "seed_reading.sql")
    open(path, "w").write("\n".join(out) + "\n")
    print(path, len(Q), "тестов,", sum(1 for p in poems if p.get("text")), "стихов,", os.path.getsize(path) // 1024, "КБ")


if __name__ == "__main__":
    main()
