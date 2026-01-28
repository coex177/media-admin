"""API endpoints for rename/move actions."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import PendingAction, Show, Episode
from ..services.renamer import RenamerService

router = APIRouter(prefix="/api/actions", tags=["actions"])


class ActionResponse(BaseModel):
    """Response model for an action."""

    id: int
    type: str
    source_path: str
    dest_path: Optional[str]
    show_id: Optional[int]
    show_name: Optional[str] = None
    episode_id: Optional[int]
    episode_code: Optional[str] = None
    episode_title: Optional[str] = None
    status: str
    error_message: Optional[str]
    created_at: str
    completed_at: Optional[str]


def get_renamer(db: Session = Depends(get_db)) -> RenamerService:
    """Get renamer service."""
    return RenamerService(db)


@router.get("")
async def list_actions(
    db: Session = Depends(get_db),
    status: Optional[str] = Query(None, pattern="^(pending|approved|completed|rejected|failed)$"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
):
    """List pending actions."""
    query = db.query(PendingAction)

    if status:
        query = query.filter(PendingAction.status == status)
    else:
        # Default to pending
        query = query.filter(PendingAction.status == "pending")

    actions = query.order_by(PendingAction.created_at.desc()).offset(skip).limit(limit).all()

    result = []
    for action in actions:
        action_dict = action.to_dict()

        # Add show/episode info
        if action.show_id:
            show = db.query(Show).filter(Show.id == action.show_id).first()
            if show:
                action_dict["show_name"] = show.name

        if action.episode_id:
            episode = db.query(Episode).filter(Episode.id == action.episode_id).first()
            if episode:
                action_dict["season"] = episode.season
                action_dict["episode"] = episode.episode
                action_dict["episode_code"] = f"S{episode.season:02d}E{episode.episode:02d}"
                action_dict["episode_title"] = episode.title

        result.append(action_dict)

    return result


@router.get("/{action_id}")
async def get_action(action_id: int, db: Session = Depends(get_db)):
    """Get a specific action."""
    action = db.query(PendingAction).filter(PendingAction.id == action_id).first()
    if not action:
        raise HTTPException(status_code=404, detail="Action not found")

    action_dict = action.to_dict()

    # Add show/episode info
    if action.show_id:
        show = db.query(Show).filter(Show.id == action.show_id).first()
        if show:
            action_dict["show_name"] = show.name

    if action.episode_id:
        episode = db.query(Episode).filter(Episode.id == action.episode_id).first()
        if episode:
            action_dict["episode_code"] = f"S{episode.season:02d}E{episode.episode:02d}"
            action_dict["episode_title"] = episode.title

    return action_dict


@router.post("/{action_id}/approve")
async def approve_action(
    action_id: int,
    renamer: RenamerService = Depends(get_renamer),
):
    """Approve and execute a single action."""
    result = renamer.approve_action(action_id)

    if result is None:
        raise HTTPException(status_code=404, detail="Action not found")

    return {
        "success": result.success,
        "source_path": result.source_path,
        "dest_path": result.dest_path,
        "error": result.error,
    }


@router.post("/approve-all")
async def approve_all_actions(
    renamer: RenamerService = Depends(get_renamer),
):
    """Approve and execute all pending actions."""
    results = renamer.approve_all_pending()

    success_count = sum(1 for r in results if r.success)
    failed_count = len(results) - success_count

    return {
        "total": len(results),
        "success": success_count,
        "failed": failed_count,
        "results": [
            {
                "success": r.success,
                "source_path": r.source_path,
                "dest_path": r.dest_path,
                "error": r.error,
            }
            for r in results
        ],
    }


@router.post("/{action_id}/reject")
async def reject_action(
    action_id: int,
    renamer: RenamerService = Depends(get_renamer),
):
    """Reject a pending action."""
    success = renamer.reject_action(action_id)

    if not success:
        raise HTTPException(status_code=404, detail="Action not found")

    return {"message": "Action rejected"}


@router.delete("/{action_id}")
async def delete_action(action_id: int, db: Session = Depends(get_db)):
    """Delete an action."""
    action = db.query(PendingAction).filter(PendingAction.id == action_id).first()
    if not action:
        raise HTTPException(status_code=404, detail="Action not found")

    db.delete(action)
    db.commit()

    return {"message": "Action deleted"}


@router.get("/preview/{action_id}")
async def preview_action(
    action_id: int,
    db: Session = Depends(get_db),
    renamer: RenamerService = Depends(get_renamer),
):
    """Preview what an action would do."""
    action = db.query(PendingAction).filter(PendingAction.id == action_id).first()
    if not action:
        raise HTTPException(status_code=404, detail="Action not found")

    return renamer.preview_rename(action)
