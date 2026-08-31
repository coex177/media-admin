"""Agent pairing: create an agent (token shown once), list with online status, revoke."""

import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Agent
from ..services.agent_hub import hub
from .auth import token_hash

router = APIRouter(prefix="/api/agents", tags=["agents"])


class AgentCreate(BaseModel):
    name: str


@router.get("")
async def list_agents(db: Session = Depends(get_db)):
    return [{**a.to_dict(), "online": hub.is_online(a.id), "roots": hub.roots(a.id)} for a in db.query(Agent).all()]


@router.post("")
async def create_agent(data: AgentCreate, db: Session = Depends(get_db)):
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    token = secrets.token_urlsafe(32)
    agent = Agent(name=name, token_hash=token_hash(token))
    db.add(agent)
    db.commit()
    db.refresh(agent)
    # The plaintext token exists only in this response; the agent config is the only copy.
    return {**agent.to_dict(), "token": token}


@router.delete("/{agent_id}")
async def delete_agent(agent_id: int, db: Session = Depends(get_db)):
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    db.delete(agent)
    db.commit()
    await hub.disconnect(agent_id)
    return {"ok": True}
