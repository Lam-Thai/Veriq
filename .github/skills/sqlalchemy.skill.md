# Skill: SQLAlchemy (FastAPI Runtime)
> Mirrors the Prisma schema. Never runs migrations — Prisma owns schema truth.

## Async Session Setup

```python
# app/db.py
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

engine = create_async_engine(
    settings.DATABASE_URL,  # postgresql+asyncpg://...
    pool_size=10,
    max_overflow=20,
    echo=False,
)

AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
```

---

## Model Conventions
> Table names must match Prisma's PascalCase defaults exactly.

```python
# app/models/invoice.py
from sqlalchemy import String, Numeric, DateTime, Enum as SAEnum, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime
from decimal import Decimal
from app.db import Base
import enum


class InvoiceStatus(enum.Enum):
    DRAFT = "DRAFT"
    SENT  = "SENT"
    PAID  = "PAID"
    VOID  = "VOID"


class Invoice(Base):
    __tablename__ = "Invoice"  # match Prisma PascalCase — never snake_case

    id: Mapped[str] = mapped_column(String, primary_key=True)
    status: Mapped[InvoiceStatus] = mapped_column(
        SAEnum(InvoiceStatus, name="InvoiceStatus"), default=InvoiceStatus.DRAFT
    )
    total: Mapped[Decimal] = mapped_column(Numeric(10, 2))           # never Float
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user_id: Mapped[str] = mapped_column(String, ForeignKey("User.id", ondelete="CASCADE"))

    user: Mapped["User"] = relationship(back_populates="invoices")
    items: Mapped[list["InvoiceItem"]] = relationship(back_populates="invoice")

    __table_args__ = (
        Index("invoice_user_id_idx", "user_id"),
        Index("invoice_user_status_idx", "user_id", "status"),
    )
```

---

## Query Patterns

### Always filter soft-deleted rows
```python
from sqlalchemy import select

result = await db.execute(
    select(Invoice)
    .where(Invoice.user_id == user_id, Invoice.deleted_at.is_(None))
    .order_by(Invoice.created_at.desc())
    .limit(20).offset(page * 20)
)
invoices = result.scalars().all()
```

### Single row — raise NotFoundError if missing
```python
result = await db.execute(
    select(Invoice).where(
        Invoice.id == invoice_id,
        Invoice.user_id == user_id,   # always scope to user — IDOR protection
        Invoice.deleted_at.is_(None),
    )
)
invoice = result.scalar_one_or_none()
if not invoice:
    raise NotFoundError("Invoice")   # 404, not 403
```

### Insert
```python
invoice = Invoice(id=generate_cuid(), user_id=user_id, total=data.total, ...)
db.add(invoice)
await db.commit()
await db.refresh(invoice)
```

### Bulk insert
```python
db.add_all([Invoice(**row) for row in rows])
await db.commit()
```

### Update
```python
result = await db.execute(
    select(Invoice).where(Invoice.id == invoice_id, Invoice.user_id == user_id)
)
invoice = result.scalar_one_or_none()
if not invoice:
    raise NotFoundError("Invoice")

invoice.status = InvoiceStatus.SENT
invoice.updated_at = datetime.now(UTC)
await db.commit()
await db.refresh(invoice)
```

### Soft delete
```python
invoice.deleted_at = datetime.now(UTC)
await db.commit()
```

### Transaction (multi-step writes)
```python
async with db.begin():
    invoice = Invoice(...)
    db.add(invoice)
    items = [InvoiceItem(..., invoice_id=invoice.id) for item in data.items]
    db.add_all(items)
# commits on __aexit__, rolls back on exception
```

### Pagination with count
```python
from sqlalchemy import func

count_result = await db.execute(
    select(func.count()).select_from(Invoice)
    .where(Invoice.user_id == user_id, Invoice.deleted_at.is_(None))
)
total = count_result.scalar_one()

rows_result = await db.execute(
    select(Invoice)
    .where(Invoice.user_id == user_id, Invoice.deleted_at.is_(None))
    .order_by(Invoice.created_at.desc())
    .limit(per_page).offset(page * per_page)
)
rows = rows_result.scalars().all()
```

---

## Serialize to Pydantic

```python
# model_config = {"from_attributes": True} on response schema
response = InvoiceResponse.model_validate(invoice)  # ORM → Pydantic, no manual mapping
```

---

## Non-Negotiable Rules
- Table names match Prisma PascalCase (`"Invoice"` not `"invoices"`).
- `Numeric(10, 2)` for all monetary columns — never `Float`.
- Every query scoped to `user_id` — no bare ID-only lookups.
- Always filter `deleted_at.is_(None)` in list and single-row queries.
- Multi-step writes always inside `async with db.begin()`.
- FastAPI never runs Alembic migrations on Prisma-managed tables.
- Return `NotFoundError` (→ 404), never `ForbiddenError` (→ 403) for ownership failures.

## Audit Checklist
- [ ] Table name matches Prisma PascalCase
- [ ] `Numeric(10,2)` for monetary columns
- [ ] All queries scoped to `user_id`
- [ ] `deleted_at.is_(None)` in all list/single queries
- [ ] Multi-step writes in transaction
- [ ] ORM model serialized via Pydantic (`model_validate`)
- [ ] No raw SQL string interpolation
- [ ] No Alembic migration competing with Prisma
