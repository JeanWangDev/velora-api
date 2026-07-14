import { DataTypes, Model } from "sequelize";
import { getSequelize } from "@/db/connection";

export type AccountType = "funding" | "trading" | "futures" | "earn" | "margin";

export class AccountBalance extends Model {
  declare id: number;
  declare userId: number;
  declare currency: string;
  declare accountType: AccountType;
  declare available: string;
  declare frozen: string;
  declare createTime: Date;
  declare updateTime: Date;
}

export async function initAccountBalanceModel() {
  const sequelize = await getSequelize();
  if (!sequelize) return;

  AccountBalance.init(
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
      available: {
        type: DataTypes.DECIMAL(36, 12),
        field: "f_available",
        allowNull: false,
        defaultValue: 0,
      },
      frozen: {
        type: DataTypes.DECIMAL(36, 12),
        field: "f_frozen",
        allowNull: false,
        defaultValue: 0,
      },
      createTime: {
        type: DataTypes.DATE,
        field: "f_create_time",
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updateTime: {
        type: DataTypes.DATE,
        field: "f_update_time",
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      modelName: "AccountBalance",
      tableName: "t_account_balance",
      createdAt: false,
      updatedAt: false,
      freezeTableName: true,
    },
  );
}
