<?php

declare(strict_types=1);

namespace Wowie\Api\Stratego;

/**
 * Thrown for every Stratego rule violation. ruleCode() returns a stable
 * machine-readable code such as 'not_your_turn', 'illegal_move',
 * 'two_square_rule', 'invalid_setup' or 'wrong_phase'.
 */
final class StrategoRuleException extends \InvalidArgumentException
{
    private readonly string $ruleCode;

    public function __construct(string $ruleCode, string $message = '', ?\Throwable $previous = null)
    {
        $this->ruleCode = $ruleCode;
        parent::__construct($message !== '' ? $message : $ruleCode, 0, $previous);
    }

    public function ruleCode(): string
    {
        return $this->ruleCode;
    }
}
