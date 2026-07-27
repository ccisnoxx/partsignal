"""验证身份请求模型的密码长度边界。"""

import pytest
from pydantic import ValidationError

from app.schemas.common import ChangePasswordRequest, ResetPasswordRequest, UserCreate


def test_formal_password_rejects_seven_characters_and_accepts_eight() -> None:
    with pytest.raises(ValidationError):
        ChangePasswordRequest(old_password="old-pass", new_password="1234567")

    request = ChangePasswordRequest(old_password="old-pass", new_password="12345678")
    assert request.new_password == "12345678"


def test_temporary_password_minimum_lengths_remain_unchanged() -> None:
    with pytest.raises(ValidationError):
        UserCreate(
            username="user",
            display_name="用户",
            temporary_password="12345678901",
            account_type="ENGINEER",
        )
    assert UserCreate(
        username="user",
        display_name="用户",
        temporary_password="123456789012",
        account_type="ENGINEER",
    ).temporary_password == "123456789012"

    with pytest.raises(ValidationError):
        ResetPasswordRequest(temporary_password="1234567")
    assert (
        ResetPasswordRequest(temporary_password="12345678").temporary_password
        == "12345678"
    )
