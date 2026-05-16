import { Hono } from "hono";
import { curriculumMap } from "../db/curriculum.js";

export const curriculumRoutes = new Hono();

// 学習指導要領 × 学年 × 教科 × 単元 の静的マップ。 spec/manabi-no-tabibito.md と連動。
curriculumRoutes.get("/", (c) => c.json({ curriculum: curriculumMap }));
