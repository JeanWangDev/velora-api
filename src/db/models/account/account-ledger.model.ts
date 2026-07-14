import { DataTypes, Model } from "sequelize";
import { getSequelize } from "@/db/connection";

export type LedgerType =
  | "deposit"
  | "withdraw"
  | "trade"
  | "fee"
  | "freeze"
  | "unfreeze"
  | "credit"
  | "transfer";

export type LedgerAccountType = "funding" | "trading" | "futures";

export class AccountLedger extends Model {
  declare id: number;
  declare userId: number;
  declare currency: string;
  declare accountType: LedgerAccountType;
  declare type: LedgerType;
  declare amount: string;
  declare balanceAfter: string;
  declare refId: string;
  declare createTime: Date;
}

export async function initAccountLedgerModel() {
  const sequelize = await getSequelize();
  if (!sequelize) return;

  AccountLedger.init(
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, field: "f_id" },
      userId: { type: DataTypes.BIGINT, field: "f_user_id", allowNull: false },
      currency: { type: DataTypes.STRING(16), field: "f_currency", allowNull: false },
      accountType: {
        type: DataTypes.STRING(16),
        field: "f_account_type",
        allowNull: false,
        defaultValue: "trading",
      },
      type: { type: DataTypes.STRING(16), field: "f_type", allowNull: false },
      amount: { type: DataTypes.DECIMAL(36, 12), field: "f_amount", allowNull: false },
      balanceAfter: {
        type: DataTypes.DECIMAL(36, 12),
        field: "f_balance_after",
        allowNull: false,
      },
      refId: { type: DataTypes.STRING(64), field: "f_ref_id", allowNull: false, defaultValue: "" },
      createTime: {
        type: DataTypes.DATE,
        field: "f_create_time",
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      modelName: "AccountLedger",
      tableName: "t_account_ledger",
      createdAt: false,
      updatedAt: false,
      freezeTableName: true,
    },
  );
}
