"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

interface ResumeTailorProps {
  resumeId: string;
}

const ROLES = ["BIM Manager", "BIM Coordinator", "Revit Modeler"];

export default function ResumeTailor({ resumeId }: ResumeTailorProps) {
  const [selectedRole, setSelectedRole] = useState(ROLES[0]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleTailor = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/resumes/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeId, roleName: selectedRole }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to tailor resume");
      }

      // Success! Refresh the page so the parent component fetches the new version
      router.refresh();
      alert("Resume successfully tailored for " + selectedRole + "!");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm mt-8 max-w-lg">
      <h3 className="text-xl font-semibold mb-2">Tailor Your Resume</h3>
      <p className="text-gray-500 text-sm mb-4">
        Automatically adjust your resume's skills and summary to match a specific BIM role.
      </p>

      <div className="flex flex-col space-y-4">
        <div>
          <label htmlFor="role-select" className="block text-sm font-medium text-gray-700 mb-1">
            Target Role
          </label>
          <select
            id="role-select"
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value)}
            className="w-full border border-gray-300 rounded-lg p-2.5 bg-gray-50 text-gray-900 focus:ring-blue-500 focus:border-blue-500 transition-colors"
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </div>

        {error && <div className="text-red-500 text-sm p-2 bg-red-50 rounded">{error}</div>}

        <button
          onClick={handleTailor}
          disabled={isLoading}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center"
        >
          {isLoading ? (
            <span className="flex items-center space-x-2">
              <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Tailoring...</span>
            </span>
          ) : (
            "Tailor Resume"
          )}
        </button>
      </div>
    </div>
  );
}
