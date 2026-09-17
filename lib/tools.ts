// Günlük antrenman/beslenme/ölçüm kayıtları memory tool'a değil, buraya
// gider — çünkü bunlar Claude'un "yorumlayıp özetleyeceği" değil, ham veri
// olarak saklanması gereken loglar. get_recent_logs ile Claude bu veriyi
// geri okuyup analiz eder.

import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const LOGS_KEY = "coach:logs";

export const customTools = [
  {
    name: "log_workout",
    description: "Bugünkü antrenmanı kaydeder: yapılan hareketler, set/tekrar/ağırlık.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: { type: "string", description: "YYYY-MM-DD formatında tarih" },
        exercises: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              sets: { type: "number" },
              reps: { type: "number" },
              weight_kg: { type: "number" },
            },
            required: ["name"],
          },
        },
        notes: { type: "string" },
      },
      required: ["date", "exercises"],
    },
  },
  {
    name: "log_meal",
    description: "Bir öğünü makro bilgisiyle kaydeder.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: { type: "string", description: "YYYY-MM-DD" },
        meal_name: { type: "string" },
        calories: { type: "number" },
        protein_g: { type: "number" },
        carbs_g: { type: "number" },
        fat_g: { type: "number" },
      },
      required: ["date", "meal_name"],
    },
  },
  {
    name: "update_body_metrics",
    description: "Kilo veya vücut ölçümü günceller.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: { type: "string", description: "YYYY-MM-DD" },
        weight_kg: { type: "number" },
        notes: { type: "string" },
      },
      required: ["date"],
    },
  },
  {
    name: "get_recent_logs",
    description: "Son N günün antrenman, öğün ve ölçüm kayıtlarını getirir.",
    input_schema: {
      type: "object" as const,
      properties: {
        days: { type: "number", description: "Kaç günlük veri isteniyor (varsayılan 7)" },
      },
      required: [],
    },
  },
];

export async function executeTool(name: string, input: Record<string, any>): Promise<string> {
  switch (name) {
    case "log_workout": {
      const key = `${input.date}:workout`;
      await redis.hset(LOGS_KEY, {
        [key]: JSON.stringify({ exercises: input.exercises, notes: input.notes ?? "" }),
      });
      return `Antrenman kaydedildi: ${input.date}`;
    }
    case "log_meal": {
      const key = `${input.date}:meal:${input.meal_name}`;
      await redis.hset(LOGS_KEY, {
        [key]: JSON.stringify({
          calories: input.calories,
          protein_g: input.protein_g,
          carbs_g: input.carbs_g,
          fat_g: input.fat_g,
        }),
      });
      return `Öğün kaydedildi: ${input.meal_name} (${input.date})`;
    }
    case "update_body_metrics": {
      const key = `${input.date}:metrics`;
      await redis.hset(LOGS_KEY, {
        [key]: JSON.stringify({ weight_kg: input.weight_kg, notes: input.notes ?? "" }),
      });
      return `Ölçüm güncellendi: ${input.date}`;
    }
    case "get_recent_logs": {
      const all = (await redis.hgetall<Record<string, string>>(LOGS_KEY)) ?? {};
      const days = input.days ?? 7;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);

      const filtered = Object.entries(all).filter(([key]) => {
        const datePart = key.split(":")[0];
        const d = new Date(datePart);
        return !isNaN(d.getTime()) && d >= cutoff;
      });

      if (filtered.length === 0) return "Son günlerde kayıtlı log yok.";
      return filtered
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n");
    }
    default:
      return `Bilinmeyen araç: ${name}`;
  }
}
