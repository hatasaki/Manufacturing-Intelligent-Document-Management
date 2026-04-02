import json
import logging

from azure.identity import DefaultAzureCredential
from azure.ai.projects import AIProjectClient

from config import Config
from services.auth_service import retry_with_backoff

logger = logging.getLogger(__name__)


def _get_project_client():
    credential = DefaultAzureCredential()
    return AIProjectClient(
        endpoint=Config.FOUNDRY_PROJECT_ENDPOINT,
        credential=credential,
    )


def generate_questions(analysis_text: str, lang: str = "en") -> list:
    """Generate follow-up questions using the question-generator-agent."""
    def call_agent():
        project_client = _get_project_client()
        openai_client = project_client.get_openai_client()
        agent = project_client.agents.get(agent_name="question-generator-agent")

        # Prepend language instruction when Japanese is requested
        input_text = analysis_text
        if lang == "ja":
            input_text = (
                "[INSTRUCTION: Generate all questions and perspectives in Japanese.]\n\n"
                + analysis_text
            )

        # Create a conversation and send analysis text as input
        conversation = openai_client.conversations.create()
        response = openai_client.responses.create(
            conversation=conversation.id,
            input=input_text,
            extra_body={"agent_reference": {"name": agent.name, "type": "agent_reference"}},
        )

        output_text = response.output_text
        # Strip markdown code fences if present
        if output_text.startswith("```"):
            lines = output_text.split("\n")
            lines = [l for l in lines if not l.startswith("```")]
            output_text = "\n".join(lines)
        return json.loads(output_text)

    return retry_with_backoff(call_agent, max_retries=3, base_delay=1.0)


def analyze_answer(question: str, answer: str, lang: str = "en") -> dict:
    """Analyze the sufficiency of an answer using the answer-analysis-agent."""
    def call_agent():
        project_client = _get_project_client()
        openai_client = project_client.get_openai_client()
        agent = project_client.agents.get(agent_name="answer-analysis-agent")

        payload = {"question": question, "answer": answer}
        if lang == "ja":
            payload["instruction"] = "Respond entirely in Japanese. Write all feedback in Japanese."
        prompt = json.dumps(payload)
        response = openai_client.responses.create(
            input=prompt,
            extra_body={"agent_reference": {"name": agent.name, "type": "agent_reference"}},
        )

        output_text = response.output_text
        if output_text.startswith("```"):
            lines = output_text.split("\n")
            lines = [l for l in lines if not l.startswith("```")]
            output_text = "\n".join(lines)
        return json.loads(output_text)

    return retry_with_backoff(call_agent, max_retries=3, base_delay=1.0)
