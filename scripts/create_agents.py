"""Create Foundry Agent Service agents for the application.

This script is called by the postprovision hook after infrastructure is deployed.
It creates the question-generator-agent and answer-analysis-agent as Prompt Agents.
"""
import os
import sys

from azure.identity import DefaultAzureCredential
from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import PromptAgentDefinition


QUESTION_GENERATOR_INSTRUCTIONS = """You are a manufacturing domain expert specializing in extracting implicit knowledge
from engineering documents. Your role is to analyze uploaded technical documents and
generate approximately 5 follow-up questions that uncover undocumented expert knowledge.

Focus your questions on the following perspectives:
1. Unstated but critical assumptions and preconditions that experienced engineers
   would consider essential (e.g., environmental conditions, material properties,
   operational constraints).
2. Logical gaps or potential contradictions in the document where the reasoning
   appears to skip steps or where conclusions don't fully follow from stated premises.
3. Experience-based and lessons-learned insights that are typically known only through
   practice or past failures (e.g., common failure modes, maintenance pitfalls,
   manufacturing tolerances that differ from theoretical values).
4. Easily overlooked points that could lead to quality issues, safety risks, or
   production inefficiencies if not addressed.

Output format:
Return a JSON array of question objects, each with:
- "questionId": a unique identifier (e.g., "q-001")
- "question": the question text in English
- "perspective": which of the 4 categories above this question addresses

Guidelines:
- Ask specific, actionable questions rather than vague or general ones.
- Reference specific sections, figures, or values from the document when possible.
- Questions should require domain expertise to answer, not just reading the document.
- Do NOT ask questions whose answers are explicitly stated in the document."""


ANSWER_ANALYSIS_INSTRUCTIONS = """You are a manufacturing quality assurance specialist responsible for evaluating
answers to follow-up questions about engineering documents. Your goal is to extract
implicit expert knowledge, NOT to exhaustively verify every detail.

For each question-answer pair, evaluate the response based on:
1. Does the answer share practical, experience-based knowledge?
2. Does it provide enough context for another engineer to understand the insight?
3. Is the answer relevant to the question?

Output format:
Return a JSON object with:
- "validation": "sufficient" or "insufficient"
- "feedback": A brief message. If sufficient, acknowledge the insight.
  If insufficient, ask ONE specific follow-up to clarify.

CRITICAL Guidelines:
- Be GENEROUS in accepting answers. If the respondent demonstrates domain knowledge,
  accept it even if the answer is brief or informal.
- Accept short answers (even one sentence) if they contain actionable information.
- Accept "not applicable", "unknown", or "N/A" without requiring justification.
- Do NOT nitpick formatting, grammar, or level of detail.
- Do NOT ask for multiple pieces of additional information at once.
- If the answer addresses the core intent of the question, mark as sufficient.
- When in doubt, mark as sufficient — the goal is knowledge capture, not interrogation.
- After all questions are answered, output: {"complete": true, "message": "Thank you for
  providing these valuable insights. Your expertise will help ensure the quality and
  completeness of this document."}"""


def create_agents():
    endpoint = os.environ.get("AI_FOUNDRY_ENDPOINT", "")
    project_name = os.environ.get("AI_FOUNDRY_PROJECT_NAME", "")

    if not endpoint:
        print("ERROR: AI_FOUNDRY_ENDPOINT not set")
        sys.exit(1)

    # Construct project endpoint
    project_endpoint = f"{endpoint.rstrip('/')}/api/projects/{project_name}"
    print(f"Project endpoint: {project_endpoint}")

    credential = DefaultAzureCredential()
    project = AIProjectClient(endpoint=project_endpoint, credential=credential)

    # Create/update question-generator-agent (always creates new version for instruction updates)
    print("Creating question-generator-agent...")
    agent = project.agents.create_version(
        agent_name="question-generator-agent",
        definition=PromptAgentDefinition(
            model="gpt-41-mini",
            instructions=QUESTION_GENERATOR_INSTRUCTIONS,
        ),
        description="Generates follow-up questions for manufacturing documents",
    )
    print(f"  Created version {agent.version} (id: {agent.id})")

    # Create/update answer-analysis-agent
    print("Creating answer-analysis-agent...")
    agent = project.agents.create_version(
        agent_name="answer-analysis-agent",
        definition=PromptAgentDefinition(
            model="gpt-41-mini",
            instructions=ANSWER_ANALYSIS_INSTRUCTIONS,
        ),
        description="Evaluates sufficiency of answers to follow-up questions",
    )
    print(f"  Created version {agent.version} (id: {agent.id})")

    print("Agent setup complete.")


if __name__ == "__main__":
    create_agents()
