import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const { resumeId, roleName } = await req.json();

    if (!resumeId || !roleName) {
      return NextResponse.json({ error: "resumeId and roleName are required" }, { status: 400 });
    }

    // 1. Fetch the Role Template
    const template = await db.roleTemplate.findUnique({
      where: { roleName },
    });

    if (!template) {
      return NextResponse.json({ error: "Role template not found" }, { status: 404 });
    }

    // 2. Fetch the Resume and its latest version
    const resume = await db.resume.findUnique({
      where: { id: resumeId },
      include: {
        versions: {
          orderBy: { version: "desc" },
          take: 1,
        },
      },
    });

    if (!resume || resume.versions.length === 0) {
      return NextResponse.json({ error: "Resume or versions not found" }, { status: 404 });
    }

    const latestVersion = resume.versions[0];
    const resumeData = latestVersion.content as any;

    // 3. Apply non-AI Tailoring Logic
    // We will clone the resume data and augment it with the role template data
    const tailoredData = { ...resumeData };
    
    // Ensure tailoredData has skills array
    if (!tailoredData.skills) tailoredData.skills = [];
    
    // A simple rule: Add template skills that are missing in the resume (just as an example of tailoring)
    const existingSkills = new Set((tailoredData.skills || []).map((s: string) => s.toLowerCase()));
    
    for (const skill of template.skills) {
      if (!existingSkills.has(skill.toLowerCase())) {
        tailoredData.skills.push(skill); // Injecting highly relevant skill keyword
      }
    }
    
    // Add a targeted summary if one doesn't exist, based on template description
    if (!tailoredData.summary && template.description) {
      tailoredData.summary = `Experienced professional aiming for a ${template.roleName} role. ${template.description}`;
    }

    // You could also add logic to match and format bullet points based on template.bulletTemplates

    // 4. Save the new Tailored Version
    const newVersion = await db.resumeVersion.create({
      data: {
        resumeId: resume.id,
        version: latestVersion.version + 1,
        content: tailoredData,
        source: "SYSTEM_TAILORED",
        label: `Tailored for ${template.roleName}`,
      },
    });

    // Update the parent Resume to mark it as targeted
    await db.resume.update({
      where: { id: resume.id },
      data: { 
        targetRole: template.roleName,
        kind: "TARGETED",
        currentVersionId: newVersion.id
      }
    });

    return NextResponse.json({ success: true, version: newVersion });
  } catch (error: any) {
    console.error("Resume Tailoring Error:", error);
    return NextResponse.json({ error: "Failed to tailor resume" }, { status: 500 });
  }
}
