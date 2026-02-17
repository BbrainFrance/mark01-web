import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";

const MARK2_API_URL = process.env.MARK2_API_URL || process.env.MARK01_API_URL || "http://76.13.42.188:3456";
const MARK2_API_KEY = process.env.MARK2_API_KEY || process.env.MARK01_API_KEY || "";

const mark2Headers = {
  "Authorization": `Bearer ${MARK2_API_KEY}`,
  "Content-Type": "application/json",
};

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!(await verifyAuth(token))) {
    return NextResponse.json({ error: "Non autorise" }, { status: 401 });
  }

  try {
    const body = await req.json();

    const res = await fetch(`${MARK2_API_URL}/chat/async`, {
      method: "POST",
      headers: mark2Headers,
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Erreur inconnue";
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
