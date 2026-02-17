import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";

const MARK2_API_URL = process.env.MARK2_API_URL || "http://76.13.42.188:3456";
const MARK2_API_KEY = process.env.MARK2_API_KEY || "";

const mark2Headers = {
  "Authorization": `Bearer ${MARK2_API_KEY}`,
  "Content-Type": "application/json",
};

// GET - Proxy vers Mark2 /models (liste des modeles)
export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!(await verifyAuth(token))) {
    return NextResponse.json({ error: "Non autorise" }, { status: 401 });
  }

  try {
    const res = await fetch(`${MARK2_API_URL}/models`, {
      headers: mark2Headers,
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { error: `Proxy models error: ${e instanceof Error ? e.message : "inconnue"}` },
      { status: 502 }
    );
  }
}

// POST - Proxy vers Mark2 /model (changer de modele)
export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!(await verifyAuth(token))) {
    return NextResponse.json({ error: "Non autorise" }, { status: 401 });
  }

  try {
    const body = await req.json();

    const res = await fetch(`${MARK2_API_URL}/model`, {
      method: "POST",
      headers: mark2Headers,
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { error: `Proxy model switch error: ${e instanceof Error ? e.message : "inconnue"}` },
      { status: 502 }
    );
  }
}
