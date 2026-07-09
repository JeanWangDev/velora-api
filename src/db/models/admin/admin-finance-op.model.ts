import { DataTypes, Model } from "sequelize";
import { getSequelize } from "@/db/connection";

export type AdminFinanceOpType = "credit" | "debit";

export class AdminFinanceOp extends Model {
  declare id: number;
  declare opNo: string;
  declare operatorId: number;
  declare targetUserId: number;
  declare currency: string;
  declare amount: string;
  declare type: AdminFinanceOpType;
  declare remark: string;
  declare createTime: Date;
}

export async function initAdminFinanceOpModel() {
  const sequelize = await getSequelize();
  if (!sequelize) return;

  AdminFinanceOp.init(
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, field: "f_id" },
      opNo: { type: DataTypes.STRING(32), field: "f_op_no", allowNull: false, unique: true },
      operatorId: { type: DataTypes.BIGINT, field: "f_operator_id", allowNull: false },
      targetUserId: { type: DataTypes.BIGINT, field: "f_target_user_id", allowNull: false },
      currency: { type: DataTypes.STRING(16), field: "f_currency", allowNull: false },
      amount: { type: DataTypes.DECIMAL(36, 12), field: "f_amount", allowNull: false },
      type: { type: DataTypes.STRING(16), field: "f_type", allowNull: false },
      remark: { type: DataTypes.STRING(255), field: "f_remark", allowNull: false, defaultValue: "" },
      createTime: {
        type: DataTypes.DATE,
        field: "f_create_time",
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      modelName: "AdminFinanceOp",
      tableName: "t_admin_finance_op",
      createdAt: false,
      updatedAt: false,
      freezeTableName: true,
    },
  );
}
